namespace Yuancheng.Agent.Core;

public sealed class AgentBootstrapResult(DeviceIdentity identity, Uri serverUrl) : IDisposable
{
    public DeviceIdentity Identity { get; } = identity;
    public Uri ServerUrl { get; } = serverUrl;

    public void Dispose() => Identity.Dispose();
}

public sealed class AgentBootstrapService(
    string identityPath,
    string configurationPath,
    string enrollmentPath,
    HttpClient httpClient)
{
    public async Task<AgentBootstrapResult> PrepareAsync(
        DateTimeOffset now,
        string machineName,
        string osVersion,
        string clientVersion,
        CancellationToken cancellationToken)
    {
        var identityStore = new DeviceIdentityStore(identityPath);
        var configurationStore = new AgentConfigurationStore(configurationPath);
        if (File.Exists(identityPath))
        {
            if (!File.Exists(configurationPath))
            {
                throw new InvalidDataException("设备身份存在，但服务器配置缺失，请重新生成登记包");
            }
            return new AgentBootstrapResult(
                identityStore.Load(),
                configurationStore.LoadServerUrl());
        }

        if (!File.Exists(enrollmentPath))
        {
            throw new InvalidDataException("未找到专属 enrollment.json，设备尚未登记");
        }

        var enrollment = EnrollmentDescriptor.Parse(
            await File.ReadAllTextAsync(enrollmentPath, cancellationToken),
            now);
        configurationStore.SaveServerUrl(enrollment.ServerUrl);
        var identity = await new DeviceEnrollmentClient(httpClient, identityStore).EnrollAsync(
            enrollment,
            string.IsNullOrWhiteSpace(enrollment.RequestedDeviceName)
                ? machineName
                : enrollment.RequestedDeviceName,
            osVersion,
            clientVersion,
            cancellationToken);
        File.Delete(enrollmentPath);
        return new AgentBootstrapResult(identity, enrollment.ServerUrl);
    }
}
