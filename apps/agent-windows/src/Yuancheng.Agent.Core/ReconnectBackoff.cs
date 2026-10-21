namespace Yuancheng.Agent.Core;

public sealed class ReconnectBackoff(TimeSpan initialDelay, TimeSpan maximumDelay)
{
    public TimeSpan GetDelay(int failedAttempt, double jitterRatio)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(failedAttempt);
        if (jitterRatio is < -0.5 or > 0.5)
        {
            throw new ArgumentOutOfRangeException(nameof(jitterRatio));
        }

        var exponent = Math.Min(failedAttempt, 30);
        var delayMilliseconds = initialDelay.TotalMilliseconds * Math.Pow(2, exponent);
        var cappedMilliseconds = Math.Min(delayMilliseconds, maximumDelay.TotalMilliseconds);
        var jitteredMilliseconds = cappedMilliseconds * (1 + jitterRatio);
        return TimeSpan.FromMilliseconds(Math.Clamp(
            jitteredMilliseconds,
            0,
            maximumDelay.TotalMilliseconds));
    }
}
