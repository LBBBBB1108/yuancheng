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

Check(
    DeviceWireProtocol.ParseAuthenticationAcknowledgement(
        """
        {"protocolVersion":1,"type":"device.authenticated","deviceId":"de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a","heartbeatIntervalSeconds":20,"testAuthorization":{"administratorId":"19d7b60c-f258-4be3-8e5a-698670687843","validUntil":"2026-10-29T08:00:00.000Z"}}
        """,
        "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a").TestAuthorization?.AdministratorId == "19d7b60c-f258-4be3-8e5a-698670687843",
    "认证确认应携带指定管理员的测试授权");

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

using (var protocolIdentity = new DeviceIdentityStore("unused").CreatePending())
{
    var nonceBytes = RandomNumberGenerator.GetBytes(32);
    var nonce = Convert.ToBase64String(nonceBytes)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
    var challengeJson = $$"""
        {"protocolVersion":1,"type":"device.auth.challenge","nonce":"{{nonce}}","expiresAt":"2026-10-22T08:00:15.000Z"}
        """;
    var authResponseJson = DeviceWireProtocol.CreateAuthenticationResponse(
        challengeJson,
        protocolIdentity,
        "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a",
        "0.1.0-test",
        "Windows 11",
        enrollmentNow);
    using var authResponse = JsonDocument.Parse(authResponseJson);
    var signature = Convert.FromBase64String(
        authResponse.RootElement.GetProperty("signature").GetString()!);
    Check(protocolIdentity.Verify(nonceBytes, signature), "WebSocket 认证响应必须签名原始挑战字节");
    Check(
        authResponse.RootElement.GetProperty("type").GetString() == "device.auth.response",
        "WebSocket 认证响应类型必须固定");

    var heartbeatInterval = DeviceWireProtocol.ParseAuthenticationAcknowledgement(
        """
        {"protocolVersion":1,"type":"device.authenticated","deviceId":"de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a","heartbeatIntervalSeconds":20,"testAuthorization":null}
        """,
        "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a");
    Check(heartbeatInterval.HeartbeatInterval == TimeSpan.FromSeconds(20), "认证成功响应应提供受限心跳间隔");
    Check(
        DeviceWireProtocol.ParseHeartbeatResponse(
            """
            {"protocolVersion":1,"type":"device.revoked","reason":"设备登记已被撤销"}
            """).Revoked,
        "撤销消息必须终止设备连接");
    ExpectInvalidData(
        () => DeviceWireProtocol.CreateAuthenticationResponse(
            challengeJson.Replace("}", ",\"command\":\"whoami\"}"),
            protocolIdentity,
            "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a",
            "0.1.0-test",
            "Windows 11",
            enrollmentNow),
        "WebSocket 挑战必须拒绝未知字段");
}

using (var connectionIdentity = new DeviceIdentityStore("unused").CreatePending())
{
    var connectionDeviceId = "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a";
    var connectionNonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
    var transport = new FakeDeviceWebSocketTransport([
        $$"""
        {"protocolVersion":1,"type":"device.auth.challenge","nonce":"{{connectionNonce}}","expiresAt":"2026-10-22T08:00:15.000Z"}
        """,
        $$"""
        {"protocolVersion":1,"type":"device.authenticated","deviceId":"{{connectionDeviceId}}","heartbeatIntervalSeconds":20,"testAuthorization":null}
        """,
        """
        {"protocolVersion":1,"type":"device.revoked","reason":"设备登记已被撤销"}
        """,
    ]);
    var connected = false;
    var connectionClient = new DeviceConnectionClient(
        () => transport,
        () => enrollmentNow,
        (_, _) => Task.CompletedTask);
    var result = await connectionClient.RunAsync(
        new Uri("https://yuancheng-test.onrender.com"),
        connectionIdentity,
        connectionDeviceId,
        "0.1.0-test",
        "Windows 11",
        () => connected = true,
        CancellationToken.None);

    Check(transport.Endpoint?.Scheme == "wss", "HTTPS 服务地址必须转换为 WSS");
    Check(connected, "通过挑战认证后必须报告在线状态");
    Check(transport.SentMessages.Count == 2, "认证后应发送认证响应和心跳");
    Check(result.Revoked && result.Reason == "设备登记已被撤销", "服务端撤销后连接必须结束");
    Check(transport.Closed, "连接结束时必须关闭 WebSocket");
}

var configurationPath = Path.Combine(
    Path.GetTempPath(),
    $"yuancheng-agent-config-{Guid.NewGuid():N}.json");
try
{
    var configurationStore = new AgentConfigurationStore(configurationPath);
    configurationStore.SaveServerUrl(new Uri("https://yuancheng-test.onrender.com"));
    Check(
        configurationStore.LoadServerUrl() == new Uri("https://yuancheng-test.onrender.com"),
        "客户端配置应保存后续自动连接所需的服务器地址");
    Check(
        !File.ReadAllText(configurationPath).Contains(enrollment.Token),
        "客户端持久配置不得保存一次性登记令牌");
    File.WriteAllText(configurationPath, "{\"formatVersion\":1,\"serverUrl\":\"http://example.com\"}");
    ExpectInvalidData(
        () => configurationStore.LoadServerUrl(),
        "被篡改为公网 HTTP 的客户端配置必须拒绝");
}
finally
{
    if (File.Exists(configurationPath)) File.Delete(configurationPath);
}

var bootstrapDirectory = Path.Combine(Path.GetTempPath(), $"yuancheng-bootstrap-{Guid.NewGuid():N}");
Directory.CreateDirectory(bootstrapDirectory);
try
{
    var bootstrapIdentityPath = Path.Combine(bootstrapDirectory, "identity.json");
    var bootstrapConfigurationPath = Path.Combine(bootstrapDirectory, "agent-config.json");
    var bootstrapEnrollmentPath = Path.Combine(bootstrapDirectory, "enrollment.json");
    File.WriteAllText(
        bootstrapEnrollmentPath,
        """
        {"formatVersion":1,"serverUrl":"https://yuancheng-test.onrender.com","token":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","requestedDeviceName":"财务测试机","expiresAt":"2026-10-22T08:30:00.000Z"}
        """);
    var enrollmentRequests = 0;
    using var bootstrapHttpClient = new HttpClient(new DelegateHttpHandler(_ =>
    {
        enrollmentRequests++;
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.Created)
        {
            Content = new StringContent("{\"deviceId\":\"de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a\"}"),
        });
    }));
    var bootstrap = new AgentBootstrapService(
        bootstrapIdentityPath,
        bootstrapConfigurationPath,
        bootstrapEnrollmentPath,
        bootstrapHttpClient);
    using (var firstStartup = await bootstrap.PrepareAsync(
        enrollmentNow,
        Environment.MachineName,
        "Windows 11",
        "0.1.0-test",
        CancellationToken.None))
    {
        Check(firstStartup.ServerUrl.Scheme == Uri.UriSchemeHttps, "首次启动应返回登记服务器地址");
    }
    Check(!File.Exists(bootstrapEnrollmentPath), "登记成功后应移除已消费的一次性令牌文件");
    File.Delete(bootstrapEnrollmentPath);
    using (var secondStartup = await bootstrap.PrepareAsync(
        enrollmentNow.AddMinutes(5),
        Environment.MachineName,
        "Windows 11",
        "0.1.0-test",
        CancellationToken.None))
    {
        Check(secondStartup.Identity.DeviceId == "de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a", "后续启动应加载已登记身份");
    }
    Check(enrollmentRequests == 1, "后续启动不能再次消费一次性登记令牌");
}
finally
{
    if (Directory.Exists(bootstrapDirectory)) Directory.Delete(bootstrapDirectory, recursive: true);
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

sealed class FakeDeviceWebSocketTransport(IEnumerable<string> incoming) : IDeviceWebSocketTransport
{
    private readonly Queue<string> _incoming = new(incoming);

    public Uri? Endpoint { get; private set; }
    public List<string> SentMessages { get; } = [];
    public bool Closed { get; private set; }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    public Task ConnectAsync(Uri endpoint, CancellationToken cancellationToken)
    {
        Endpoint = endpoint;
        return Task.CompletedTask;
    }

    public Task SendTextAsync(string message, CancellationToken cancellationToken)
    {
        SentMessages.Add(message);
        return Task.CompletedTask;
    }

    public Task<string> ReceiveTextAsync(CancellationToken cancellationToken) =>
        Task.FromResult(_incoming.Dequeue());

    public Task CloseAsync(CancellationToken cancellationToken)
    {
        Closed = true;
        return Task.CompletedTask;
    }
}
