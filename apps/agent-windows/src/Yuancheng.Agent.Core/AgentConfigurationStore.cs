using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Yuancheng.Agent.Core;

public sealed class AgentConfigurationStore(string filePath)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true,
    };

    public void SaveServerUrl(Uri serverUrl)
    {
        if (!IsAllowedServerUrl(serverUrl))
        {
            throw new InvalidDataException("服务器地址必须使用 HTTPS 或本机 HTTP");
        }

        var directory = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
        var temporaryPath = $"{filePath}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(
                temporaryPath,
                JsonSerializer.Serialize(new ConfigurationDocument(1, serverUrl.ToString()), JsonOptions),
                Encoding.UTF8);
            File.Move(temporaryPath, filePath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    public Uri LoadServerUrl()
    {
        ConfigurationDocument document;
        try
        {
            document = JsonSerializer.Deserialize<ConfigurationDocument>(
                File.ReadAllText(filePath, Encoding.UTF8),
                JsonOptions) ?? throw new InvalidDataException("客户端配置为空");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("客户端配置格式无效", exception);
        }

        if (document.FormatVersion != 1 ||
            !Uri.TryCreate(document.ServerUrl, UriKind.Absolute, out var serverUrl) ||
            !IsAllowedServerUrl(serverUrl))
        {
            throw new InvalidDataException("客户端配置版本或服务器地址无效");
        }
        return serverUrl;
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

    private sealed record ConfigurationDocument(int FormatVersion, string ServerUrl);
}
