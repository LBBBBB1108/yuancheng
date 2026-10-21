using System.Net.WebSockets;
using System.Text;

namespace Yuancheng.Agent.Core;

public interface IDeviceWebSocketTransport : IAsyncDisposable
{
    Task ConnectAsync(Uri endpoint, CancellationToken cancellationToken);
    Task SendTextAsync(string message, CancellationToken cancellationToken);
    Task<string> ReceiveTextAsync(CancellationToken cancellationToken);
    Task CloseAsync(CancellationToken cancellationToken);
}

public sealed record DeviceConnectionResult(bool Revoked, string? Reason);

public sealed class DeviceConnectionClient(
    Func<IDeviceWebSocketTransport> transportFactory,
    Func<DateTimeOffset> utcNow,
    Func<TimeSpan, CancellationToken, Task> delay)
{
    public DeviceConnectionClient()
        : this(
            () => new ClientDeviceWebSocketTransport(),
            () => DateTimeOffset.UtcNow,
            Task.Delay)
    {
    }

    public async Task<DeviceConnectionResult> RunAsync(
        Uri serverUrl,
        DeviceIdentity identity,
        string deviceId,
        string clientVersion,
        string osVersion,
        Action connected,
        CancellationToken cancellationToken)
    {
        await using var transport = transportFactory();
        try
        {
            await transport.ConnectAsync(CreateWebSocketEndpoint(serverUrl), cancellationToken);
            var challenge = await transport.ReceiveTextAsync(cancellationToken);
            await transport.SendTextAsync(
                DeviceWireProtocol.CreateAuthenticationResponse(
                    challenge,
                    identity,
                    deviceId,
                    clientVersion,
                    osVersion,
                    utcNow()),
                cancellationToken);
            var acknowledgement = await transport.ReceiveTextAsync(cancellationToken);
            var heartbeatInterval = DeviceWireProtocol.ParseAuthenticationAcknowledgement(
                acknowledgement,
                deviceId);
            connected();

            while (true)
            {
                await delay(heartbeatInterval, cancellationToken);
                await transport.SendTextAsync(
                    DeviceWireProtocol.CreateHeartbeat(utcNow()),
                    cancellationToken);
                var heartbeatResponse = DeviceWireProtocol.ParseHeartbeatResponse(
                    await transport.ReceiveTextAsync(cancellationToken));
                if (heartbeatResponse.Revoked)
                {
                    return new DeviceConnectionResult(true, heartbeatResponse.Reason);
                }
            }
        }
        finally
        {
            await transport.CloseAsync(CancellationToken.None);
        }
    }

    private static Uri CreateWebSocketEndpoint(Uri serverUrl)
    {
        var scheme = serverUrl.Scheme switch
        {
            "https" => "wss",
            "http" => "ws",
            _ => throw new InvalidDataException("服务器地址必须使用 HTTPS 或本机 HTTP"),
        };
        return new UriBuilder(serverUrl)
        {
            Scheme = scheme,
            Port = serverUrl.IsDefaultPort ? -1 : serverUrl.Port,
            Path = "/ws/device",
            Query = string.Empty,
            Fragment = string.Empty,
        }.Uri;
    }
}

public sealed class ClientDeviceWebSocketTransport : IDeviceWebSocketTransport
{
    private const int MaximumTextMessageBytes = 16 * 1024;
    private readonly ClientWebSocket _socket = new();

    public Task ConnectAsync(Uri endpoint, CancellationToken cancellationToken) =>
        _socket.ConnectAsync(endpoint, cancellationToken);

    public Task SendTextAsync(string message, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(message);
        return _socket.SendAsync(
            bytes,
            WebSocketMessageType.Text,
            WebSocketMessageFlags.EndOfMessage,
            cancellationToken).AsTask();
    }

    public async Task<string> ReceiveTextAsync(CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[4096];
        while (true)
        {
            var result = await _socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                throw new EndOfStreamException("服务器已关闭设备连接");
            }
            if (result.MessageType != WebSocketMessageType.Text)
            {
                throw new InvalidDataException("身份认证和心跳阶段只接受文本消息");
            }
            if (output.Length + result.Count > MaximumTextMessageBytes)
            {
                throw new InvalidDataException("服务器协议消息超过 16KB 限制");
            }
            output.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) break;
        }
        return Encoding.UTF8.GetString(output.ToArray());
    }

    public Task CloseAsync(CancellationToken cancellationToken)
    {
        if (_socket.State is WebSocketState.Open or
            WebSocketState.CloseReceived or
            WebSocketState.Connecting)
        {
            _socket.Abort();
        }
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync()
    {
        _socket.Dispose();
        return ValueTask.CompletedTask;
    }
}
