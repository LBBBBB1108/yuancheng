using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Yuancheng.Agent.Core;

public sealed record EnrollmentDescriptor(
    Uri ServerUrl,
    string Token,
    string RequestedDeviceName,
    DateTimeOffset ExpiresAt)
{
    private static readonly Regex TokenPattern = new(
        "^[A-Za-z0-9_-]{43}$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public static EnrollmentDescriptor Parse(string json, DateTimeOffset now)
    {
        DescriptorDocument document;
        try
        {
            document = JsonSerializer.Deserialize<DescriptorDocument>(json, JsonOptions)
                ?? throw new InvalidDataException("登记描述为空");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("登记描述格式无效", exception);
        }

        if (document.FormatVersion != 1 ||
            !Uri.TryCreate(document.ServerUrl, UriKind.Absolute, out var serverUrl) ||
            !IsAllowedServerUrl(serverUrl) ||
            document.Token is null ||
            !TokenPattern.IsMatch(document.Token) ||
            string.IsNullOrWhiteSpace(document.RequestedDeviceName) ||
            document.RequestedDeviceName.Length > 100 ||
            document.ExpiresAt <= now)
        {
            throw new InvalidDataException("登记描述版本、地址、令牌、设备名或有效期无效");
        }

        return new EnrollmentDescriptor(
            serverUrl,
            document.Token,
            document.RequestedDeviceName.Trim(),
            document.ExpiresAt);
    }

    private static bool IsAllowedServerUrl(Uri url)
    {
        if (!string.IsNullOrEmpty(url.UserInfo) ||
            !string.IsNullOrEmpty(url.Query) ||
            !string.IsNullOrEmpty(url.Fragment) ||
            url.AbsolutePath != "/")
        {
            return false;
        }

        if (url.Scheme == Uri.UriSchemeHttps) return true;
        if (url.Scheme != Uri.UriSchemeHttp) return false;
        return string.Equals(url.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
               (IPAddress.TryParse(url.Host, out var address) && IPAddress.IsLoopback(address));
    }

    private sealed class DescriptorDocument
    {
        public int FormatVersion { get; init; }
        public string? ServerUrl { get; init; }
        public string? Token { get; init; }
        public string? RequestedDeviceName { get; init; }
        public DateTimeOffset ExpiresAt { get; init; }
    }
}
