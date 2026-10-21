using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Yuancheng.Agent.Core;

public sealed class DeviceEnrollmentClient(
    HttpClient httpClient,
    DeviceIdentityStore identityStore)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public async Task<DeviceIdentity> EnrollAsync(
        EnrollmentDescriptor enrollment,
        string deviceName,
        string osVersion,
        string clientVersion,
        CancellationToken cancellationToken)
    {
        using var pendingIdentity = identityStore.CreatePending();
        using var response = await httpClient.PostAsJsonAsync(
            new Uri(enrollment.ServerUrl, "/api/v1/devices/enroll"),
            new EnrollmentRequest(
                enrollment.Token,
                deviceName,
                Convert.ToBase64String(pendingIdentity.PublicKey),
                osVersion,
                clientVersion),
            JsonOptions,
            cancellationToken);

        if (response.StatusCode != System.Net.HttpStatusCode.Created)
        {
            throw new InvalidOperationException($"设备登记失败，服务器返回 {(int)response.StatusCode}");
        }

        EnrollmentResponse result;
        try
        {
            result = await response.Content.ReadFromJsonAsync<EnrollmentResponse>(
                JsonOptions,
                cancellationToken) ?? throw new InvalidDataException("登记响应为空");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("登记响应格式无效", exception);
        }

        if (!Guid.TryParse(result.DeviceId, out _))
        {
            throw new InvalidDataException("登记响应中的设备 ID 无效");
        }

        identityStore.Save(pendingIdentity, result.DeviceId);
        return identityStore.Load();
    }

    private sealed record EnrollmentRequest(
        string Token,
        string DeviceName,
        string PublicKey,
        string OsVersion,
        string ClientVersion);

    private sealed record EnrollmentResponse(string DeviceId);
}
