namespace Yuancheng.Agent.Core;

public sealed record ConsentRequestState(
    string RequestId,
    string AdministratorId,
    string AdministratorDisplayName,
    IReadOnlyList<string> Permissions,
    DateTimeOffset ExpiresAt);

public sealed record PendingConsent(ConsentRequestState Request, bool AutoApproved)
{
    public string RequestId => Request.RequestId;
}

public enum ConsentDecision
{
    Authorized,
    Rejected,
    TimedOut,
    Ended,
    Invalid,
}

public sealed class ConsentStateMachine
{
    private readonly Func<DateTimeOffset> _utcNow;
    private PendingConsent? _pending;

    public ConsentStateMachine(Func<DateTimeOffset>? utcNow = null)
    {
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public PendingConsent? Current => _pending;

    public PendingConsent? Receive(
        ConsentRequestState request,
        AgentBuildMode buildMode,
        bool testAuthorizationValid,
        bool localAssistanceEnabled,
        bool designatedAdministrator)
    {
        if (_pending is not null || request.ExpiresAt <= _utcNow() ||
            string.IsNullOrWhiteSpace(request.RequestId) ||
            string.IsNullOrWhiteSpace(request.AdministratorId) ||
            string.IsNullOrWhiteSpace(request.AdministratorDisplayName) ||
            request.Permissions.Count == 0)
        {
            return null;
        }

        var autoApproved = AssistanceAuthorizationPolicy.CanAutoApprove(
            buildMode,
            testAuthorizationValid,
            localAssistanceEnabled,
            designatedAdministrator);
        _pending = new PendingConsent(request, autoApproved);
        return _pending;
    }

    public ConsentDecision Respond(string requestId, bool accepted)
    {
        if (_pending is null || _pending.RequestId != requestId) return ConsentDecision.Invalid;
        if (_pending.Request.ExpiresAt <= _utcNow())
        {
            _pending = null;
            return ConsentDecision.TimedOut;
        }

        _pending = null;
        return accepted ? ConsentDecision.Authorized : ConsentDecision.Rejected;
    }

    public ConsentDecision End(string requestId)
    {
        if (_pending is null || _pending.RequestId != requestId) return ConsentDecision.Invalid;
        _pending = null;
        return ConsentDecision.Ended;
    }

    public void Clear() => _pending = null;
}
