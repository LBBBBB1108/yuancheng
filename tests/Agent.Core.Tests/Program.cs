using System.Security.Cryptography;
using System.Text.Json;

using Yuancheng.Agent.Core;

var failures = new List<string>();

Check(
    !AssistanceAuthorizationPolicy.CanAutoApprove(
        AgentBuildMode.Production,
        testAuthorizationValid: true,
        localAssistanceEnabled: true,
        designatedAdministrator: true),
    "正式构建绝不能自动批准");
Check(
    AssistanceAuthorizationPolicy.CanAutoApprove(
        AgentBuildMode.Test,
        testAuthorizationValid: true,
        localAssistanceEnabled: true,
        designatedAdministrator: true),
    "有效测试授权应允许自动批准");
Check(
    !AssistanceAuthorizationPolicy.CanAutoApprove(
        AgentBuildMode.Test,
        testAuthorizationValid: true,
        localAssistanceEnabled: false,
        designatedAdministrator: true),
    "本机停止后不能自动恢复");

var backoff = new ReconnectBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(30));
Check(backoff.GetDelay(0, jitterRatio: 0) == TimeSpan.FromSeconds(1), "首次重连等待 1 秒");
Check(backoff.GetDelay(10, jitterRatio: 0) == TimeSpan.FromSeconds(30), "重连等待上限为 30 秒");

var enrollmentNow = new DateTimeOffset(2026, 10, 22, 8, 0, 0, TimeSpan.Zero);
var enrollment = EnrollmentDescriptor.Parse(
    """
    {
      "formatVersion": 1,
      "serverUrl": "https://yuancheng-test.onrender.com",
      "token": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "requestedDeviceName": "财务测试机",
      "expiresAt": "2026-10-22T08:30:00.000Z"
    }
    """,
    enrollmentNow);
Check(enrollment.ServerUrl.Scheme == Uri.UriSchemeHttps, "Render 登记地址必须保留 HTTPS");
Check(enrollment.RequestedDeviceName == "财务测试机", "登记描述应读取中文设备名");
ExpectInvalidData(
    () => EnrollmentDescriptor.Parse(
        """
        {"formatVersion":1,"serverUrl":"http://example.com","token":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","requestedDeviceName":"测试机","expiresAt":"2026-10-22T08:30:00.000Z"}
        """,
        enrollmentNow),
    "非本机登记地址不能使用明文 HTTP");
ExpectInvalidData(
    () => EnrollmentDescriptor.Parse(
        """
        {"formatVersion":1,"serverUrl":"https://example.com","token":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","requestedDeviceName":"测试机","expiresAt":"2026-10-22T07:59:59.000Z"}
        """,
        enrollmentNow),
    "过期登记描述必须拒绝");
ExpectInvalidData(
    () => EnrollmentDescriptor.Parse(
        """
        {"formatVersion":1,"serverUrl":"https://example.com","token":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","requestedDeviceName":"测试机","expiresAt":"2026-10-22T08:30:00.000Z","command":"whoami"}
        """,
        enrollmentNow),
    "登记描述必须拒绝未知字段");

var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
var jpeg = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 };
Check(WelcomeImageValidator.HasSupportedSignature(png), "接受 PNG 文件签名");
Check(WelcomeImageValidator.HasSupportedSignature(jpeg), "接受 JPEG 文件签名");
Check(!WelcomeImageValidator.HasSupportedSignature(new byte[] { 0x4D, 0x5A }), "拒绝伪装的可执行文件");
Check(!WelcomeImageValidator.IsAllowedSize(10 * 1024 * 1024 + 1), "拒绝超过 10MB 的图片");

var identityPath = Path.Combine(Path.GetTempPath(), $"yuancheng-identity-{Guid.NewGuid():N}.json");
try
{
    var identityStore = new DeviceIdentityStore(identityPath);
    using var createdIdentity = identityStore.CreatePending();
    Check(!File.Exists(identityPath), "服务器登记成功前不能落盘设备身份");
    identityStore.Save(createdIdentity, "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a");
    var loadedIdentity = identityStore.Load();
    var challenge = RandomNumberGenerator.GetBytes(32);
    var signature = loadedIdentity.Sign(challenge);

    Check(createdIdentity.PublicKey.SequenceEqual(loadedIdentity.PublicKey), "DPAPI 保存后应恢复同一设备公钥");
    Check(loadedIdentity.Verify(challenge, signature), "Ed25519 身份应能验证挑战签名");
    using var identityDocument = JsonDocument.Parse(File.ReadAllText(identityPath));
    Check(identityDocument.RootElement.TryGetProperty("protectedPrivateKey", out _), "身份文件应保存受保护私钥");
    Check(!identityDocument.RootElement.TryGetProperty("privateKey", out _), "身份文件不能包含明文私钥字段");
}
finally
{
    if (File.Exists(identityPath))
    {
        File.Delete(identityPath);
    }
}

var enrollmentIdentityPath = Path.Combine(
    Path.GetTempPath(),
    $"yuancheng-enrollment-identity-{Guid.NewGuid():N}.json");
try
{
    string? requestBody = null;
    Uri? requestUri = null;
    using var httpClient = new HttpClient(new DelegateHttpHandler(async request =>
    {
        requestUri = request.RequestUri;
        requestBody = await request.Content!.ReadAsStringAsync();
        return new HttpResponseMessage(System.Net.HttpStatusCode.Created)
        {
            Content = new StringContent("{\"deviceId\":\"de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a\"}"),
        };
    }));
    var enrollmentStore = new DeviceIdentityStore(enrollmentIdentityPath);
    var enrollmentClient = new DeviceEnrollmentClient(httpClient, enrollmentStore);
    using var enrolledIdentity = await enrollmentClient.EnrollAsync(
        enrollment,
        Environment.MachineName,
        "Windows 11",
        "0.1.0-test",
        CancellationToken.None);

    Check(
        requestUri == new Uri("https://yuancheng-test.onrender.com/api/v1/devices/enroll"),
        "客户端必须调用固定登记接口");
    Check(requestBody?.Contains("\"publicKey\"") == true, "登记请求必须包含独立设备公钥");
    Check(requestBody?.Contains(enrollment.Token) == true, "登记请求必须提交专属一次性令牌");
    Check(enrolledIdentity.DeviceId == "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a", "登记成功后应恢复服务器设备 ID");
    Check(File.Exists(enrollmentIdentityPath), "服务器登记成功后才保存设备身份");
}
finally
{
    if (File.Exists(enrollmentIdentityPath)) File.Delete(enrollmentIdentityPath);
}

var rejectedIdentityPath = Path.Combine(
    Path.GetTempPath(),
    $"yuancheng-rejected-identity-{Guid.NewGuid():N}.json");
try
{
    using var httpClient = new HttpClient(new DelegateHttpHandler(_ => Task.FromResult(
        new HttpResponseMessage(System.Net.HttpStatusCode.Unauthorized))));
    var enrollmentClient = new DeviceEnrollmentClient(
        httpClient,
        new DeviceIdentityStore(rejectedIdentityPath));
    await ExpectEnrollmentFailure(() => enrollmentClient.EnrollAsync(
        enrollment,
        Environment.MachineName,
        "Windows 11",
        "0.1.0-test",
        CancellationToken.None));
    Check(!File.Exists(rejectedIdentityPath), "登记被拒绝时不能留下设备身份");
}
finally
{
    if (File.Exists(rejectedIdentityPath)) File.Delete(rejectedIdentityPath);
}

if (failures.Count > 0)
{
    Console.Error.WriteLine($"失败：{string.Join("；", failures)}");
    return 1;
}

Console.WriteLine("Windows 客户端核心测试全部通过。");
return 0;

void Check(bool condition, string message)
{
    if (!condition)
    {
        failures.Add(message);
    }
}

void ExpectInvalidData(Action action, string message)
{
    try
    {
        action();
        failures.Add(message);
    }
    catch (InvalidDataException)
    {
    }
}

async Task ExpectEnrollmentFailure(Func<Task<DeviceIdentity>> action)
{
    try
    {
        using var _ = await action();
        failures.Add("登记被服务器拒绝时必须报告失败");
    }
    catch (InvalidOperationException)
    {
    }
}

sealed class DelegateHttpHandler(
    Func<HttpRequestMessage, Task<HttpResponseMessage>> handler) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken) => handler(request);
}
