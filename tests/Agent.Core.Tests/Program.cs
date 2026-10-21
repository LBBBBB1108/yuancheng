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
