namespace Yuancheng.Agent.Core;

public static class WelcomeImageValidator
{
    public const long MaximumFileSize = 10 * 1024 * 1024;
    public const int MaximumDimension = 8192;

    private static readonly byte[] PngSignature = [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    ];

    public static bool IsAllowedSize(long size) => size is > 0 and <= MaximumFileSize;

    public static bool HasSupportedSignature(ReadOnlySpan<byte> header)
    {
        return header.StartsWith(PngSignature)
            || (header.Length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF);
    }

    public static bool AreAllowedDimensions(int width, int height)
    {
        return width is > 0 and <= MaximumDimension
            && height is > 0 and <= MaximumDimension;
    }
}
