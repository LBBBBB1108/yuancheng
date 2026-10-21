namespace Yuancheng.Agent.Core;

public enum AgentBuildMode
{
    Test,
    Production,
}

public static class AssistanceAuthorizationPolicy
{
    public static bool CanAutoApprove(
        AgentBuildMode buildMode,
        bool testAuthorizationValid,
        bool localAssistanceEnabled,
        bool designatedAdministrator)
    {
        return buildMode == AgentBuildMode.Test
            && testAuthorizationValid
            && localAssistanceEnabled
            && designatedAdministrator;
    }
}
