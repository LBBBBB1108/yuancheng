using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using NSec.Cryptography;

namespace Yuancheng.Agent.Core;

public sealed class DeviceIdentity : IDisposable
{
    private static readonly SignatureAlgorithm Algorithm = SignatureAlgorithm.Ed25519;
    private readonly Key _key;

    internal DeviceIdentity(string deviceId, Key key)
    {
        DeviceId = deviceId;
        _key = key;
        PublicKey = key.PublicKey.Export(KeyBlobFormat.RawPublicKey);
    }

    public string DeviceId { get; }
    public byte[] PublicKey { get; }

    public byte[] Sign(ReadOnlySpan<byte> challenge) => Algorithm.Sign(_key, challenge);

    public bool Verify(ReadOnlySpan<byte> challenge, ReadOnlySpan<byte> signature)
    {
        return Algorithm.Verify(_key.PublicKey, challenge, signature);
    }

    public void Dispose() => _key.Dispose();

    internal byte[] ExportPrivateKey() => _key.Export(KeyBlobFormat.RawPrivateKey);
}

public sealed class DeviceIdentityStore(string filePath)
{
    private static readonly SignatureAlgorithm Algorithm = SignatureAlgorithm.Ed25519;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("yuancheng-device-identity-v1");
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public DeviceIdentity CreateAndSave(string deviceId)
    {
        var identity = CreatePending();
        Save(identity, deviceId);
        return identity;
    }

    public DeviceIdentity CreatePending()
    {
        var creationParameters = new KeyCreationParameters
        {
            ExportPolicy = KeyExportPolicies.AllowPlaintextExport,
        };
        var key = Key.Create(Algorithm, creationParameters);
        return new DeviceIdentity(string.Empty, key);
    }

    public void Save(DeviceIdentity identity, string deviceId)
    {
        if (!Guid.TryParse(deviceId, out _))
        {
            throw new InvalidDataException("设备 ID 格式无效");
        }

        var privateKey = identity.ExportPrivateKey();
        try
        {
            var protectedPrivateKey = ProtectedData.Protect(
                privateKey,
                Entropy,
                DataProtectionScope.CurrentUser);
            var document = new IdentityDocument(
                1,
                deviceId,
                Convert.ToBase64String(identity.PublicKey),
                Convert.ToBase64String(protectedPrivateKey));
            SaveAtomically(document);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(privateKey);
        }
    }

    public DeviceIdentity Load()
    {
        var document = JsonSerializer.Deserialize<IdentityDocument>(
            File.ReadAllText(filePath, Encoding.UTF8),
            JsonOptions) ?? throw new InvalidDataException("设备身份文件无效");
        if (document.FormatVersion != 1 || !Guid.TryParse(document.DeviceId, out _))
        {
            throw new InvalidDataException("设备身份文件版本或设备 ID 无效");
        }

        var protectedPrivateKey = Convert.FromBase64String(document.ProtectedPrivateKey);
        var privateKey = ProtectedData.Unprotect(
            protectedPrivateKey,
            Entropy,
            DataProtectionScope.CurrentUser);
        try
        {
            var key = Key.Import(Algorithm, privateKey, KeyBlobFormat.RawPrivateKey);
            var expectedPublicKey = Convert.FromBase64String(document.PublicKey);
            if (!CryptographicOperations.FixedTimeEquals(
                    key.PublicKey.Export(KeyBlobFormat.RawPublicKey),
                    expectedPublicKey))
            {
                key.Dispose();
                throw new InvalidDataException("设备身份公钥不匹配");
            }
            return new DeviceIdentity(document.DeviceId, key);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(privateKey);
        }
    }

    private void SaveAtomically(IdentityDocument document)
    {
        var directory = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }
        var temporaryPath = $"{filePath}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(document, JsonOptions), Encoding.UTF8);
            File.Move(temporaryPath, filePath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private sealed record IdentityDocument(
        int FormatVersion,
        string DeviceId,
        string PublicKey,
        string ProtectedPrivateKey);
}
