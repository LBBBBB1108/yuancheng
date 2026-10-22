using System.Text.Json;

namespace Yuancheng.Agent.Core;

public sealed record TestAuthorizationState(string AdministratorId, DateTimeOffset ValidUntil);
public sealed record AuthenticationAcknowledgement(TimeSpan HeartbeatInterval, TestAuthorizationState? TestAuthorization);
public sealed record HeartbeatResponse(bool Revoked, string? Reason, TestAuthorizationState? TestAuthorization = null);

public static class DeviceWireProtocol
{
    private const int ProtocolVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string CreateAuthenticationResponse(
        string challengeJson,
        DeviceIdentity identity,
        string deviceId,
        string clientVersion,
        string osVersion,
        DateTimeOffset now)
    {
        using var document = ParseDocument(challengeJson);
        var root = document.RootElement;
        RequireExactProperties(root, "protocolVersion", "type", "nonce", "expiresAt");
        RequireEnvelope(root, "device.auth.challenge");

        var nonce = RequiredString(root, "nonce");
        var challenge = DecodeBase64Url(nonce);
        if (challenge.Length != 32 ||
            !DateTimeOffset.TryParse(RequiredString(root, "expiresAt"), out var expiresAt) ||
            expiresAt <= now ||
            !Guid.TryParse(deviceId, out _))
        {
            throw new InvalidDataException("设备认证挑战或设备 ID 无效");
        }

        return JsonSerializer.Serialize(
            new
            {
                ProtocolVersion,
                Type = "device.auth.response",
                DeviceId = deviceId,
                Nonce = nonce,
                Signature = Convert.ToBase64String(identity.Sign(challenge)),
                ClientVersion = clientVersion,
                OsVersion = osVersion,
            },
            JsonOptions);
    }

    public static AuthenticationAcknowledgement ParseAuthenticationAcknowledgement(
        string responseJson,
        string expectedDeviceId)
    {
        using var document = ParseDocument(responseJson);
        var root = document.RootElement;
        RequireExactProperties(
            root,
            "protocolVersion",
            "type",
            "deviceId",
            "heartbeatIntervalSeconds", "testAuthorization");
        RequireEnvelope(root, "device.authenticated");
        if (RequiredString(root, "deviceId") != expectedDeviceId ||
            !root.TryGetProperty("heartbeatIntervalSeconds", out var intervalElement) ||
            !intervalElement.TryGetInt32(out var interval) ||
            interval is < 5 or > 60)
        {
            throw new InvalidDataException("设备认证成功响应无效");
        }
        return new AuthenticationAcknowledgement(TimeSpan.FromSeconds(interval), ParseTestAuthorization(root));
    }

    public static string CreateHeartbeat(DateTimeOffset sentAt) => JsonSerializer.Serialize(
        new
        {
            ProtocolVersion,
            Type = "device.heartbeat",
            SentAt = sentAt.UtcDateTime.ToString("O"),
        },
        JsonOptions);

    public static HeartbeatResponse ParseHeartbeatResponse(string responseJson)
    {
        using var document = ParseDocument(responseJson);
        var root = document.RootElement;
        var type = RequiredString(root, "type");
        if (type == "device.heartbeat.ack")
        {
            RequireExactProperties(root, "protocolVersion", "type", "receivedAt", "testAuthorization");
            RequireEnvelope(root, type);
            if (!DateTimeOffset.TryParse(RequiredString(root, "receivedAt"), out _))
            {
                throw new InvalidDataException("心跳确认时间无效");
            }
            return new HeartbeatResponse(false, null, ParseTestAuthorization(root));
        }
        if (type == "device.revoked")
        {
            RequireExactProperties(root, "protocolVersion", "type", "reason");
            RequireEnvelope(root, type);
            var reason = RequiredString(root, "reason");
            if (reason.Length is < 1 or > 200)
            {
                throw new InvalidDataException("设备撤销原因无效");
            }
            return new HeartbeatResponse(true, reason);
        }
        throw new InvalidDataException("心跳响应消息类型无效");
    }

    public static ConsentRequestState ParseConsentRequest(string requestJson)
    {
        using var document = ParseDocument(requestJson);
        var root = document.RootElement;
        RequireExactProperties(root, "protocolVersion", "type", "requestId", "administratorId", "administratorDisplayName", "permissions", "expiresAt");
        RequireEnvelope(root, "consent.request");
        var requestId = RequiredString(root, "requestId");
        var administratorId = RequiredString(root, "administratorId");
        var administratorDisplayName = RequiredString(root, "administratorDisplayName");
        if (!Guid.TryParse(requestId, out _) || !Guid.TryParse(administratorId, out _) ||
            administratorDisplayName.Length is < 1 or > 80 ||
            !DateTimeOffset.TryParse(RequiredString(root, "expiresAt"), out var expiresAt) ||
            !root.TryGetProperty("permissions", out var permissionsElement) || permissionsElement.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("确认请求无效");
        }
        var permissions = permissionsElement.EnumerateArray().Select(element =>
        {
            if (element.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(element.GetString()))
            {
                throw new InvalidDataException("确认权限无效");
            }
            return element.GetString()!;
        }).ToArray();
        if (permissions.Length is < 1 or > 4 || permissions.Distinct(StringComparer.Ordinal).Count() != permissions.Length || permissions.Any(permission => permission is not ("view" or "control" or "files.upload" or "files.download")))
        {
            throw new InvalidDataException("确认权限无效");
        }
        return new ConsentRequestState(requestId, administratorId, administratorDisplayName, permissions, expiresAt);
    }

    public static string CreateConsentResponse(string requestId, bool accepted) => JsonSerializer.Serialize(
        new { ProtocolVersion, Type = "consent.response", RequestId = requestId, Accepted = accepted }, JsonOptions);

    private static JsonDocument ParseDocument(string json)
    {
        try
        {
            var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                throw new InvalidDataException("协议消息必须是对象");
            }
            return document;
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("协议消息不是有效 JSON", exception);
        }
    }

    private static void RequireEnvelope(JsonElement root, string expectedType)
    {
        if (!root.TryGetProperty("protocolVersion", out var version) ||
            !version.TryGetInt32(out var versionNumber) ||
            versionNumber != ProtocolVersion ||
            RequiredString(root, "type") != expectedType)
        {
            throw new InvalidDataException("协议版本或消息类型无效");
        }
    }

    private static void RequireExactProperties(JsonElement root, params string[] allowed)
    {
        var allowedNames = allowed.ToHashSet(StringComparer.Ordinal);
        var count = 0;
        foreach (var property in root.EnumerateObject())
        {
            count++;
            if (!allowedNames.Contains(property.Name))
            {
                throw new InvalidDataException("协议消息包含未知字段");
            }
        }
        if (count != allowed.Length)
        {
            throw new InvalidDataException("协议消息缺少必要字段");
        }
    }

    private static string RequiredString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"协议字段 {name} 无效");
        }
        return value.GetString()!;
    }

    private static TestAuthorizationState? ParseTestAuthorization(JsonElement root)
    {
        if (!root.TryGetProperty("testAuthorization", out var value)) throw new InvalidDataException("测试授权字段无效");
        if (value.ValueKind == JsonValueKind.Null) return null;
        RequireExactProperties(value, "administratorId", "validUntil");
        var administratorId = RequiredString(value, "administratorId");
        if (!Guid.TryParse(administratorId, out _) || !DateTimeOffset.TryParse(RequiredString(value, "validUntil"), out var validUntil)) throw new InvalidDataException("测试授权字段无效");
        return new TestAuthorizationState(administratorId, validUntil);
    }

    private static byte[] DecodeBase64Url(string value)
    {
        try
        {
            var base64 = value.Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + ((4 - base64.Length % 4) % 4), '=');
            return Convert.FromBase64String(base64);
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException("认证挑战编码无效", exception);
        }
    }
}
