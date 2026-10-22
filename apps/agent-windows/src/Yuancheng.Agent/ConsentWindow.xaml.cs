using System.Windows;

using Yuancheng.Agent.Core;

namespace Yuancheng.Agent;

public partial class ConsentWindow : Window
{
    public ConsentWindow(ConsentRequestState request)
    {
        InitializeComponent();
        AdministratorText.Text = $"管理员：{request.AdministratorDisplayName}（{request.AdministratorId}）";
        PermissionText.Text = $"申请权限：{string.Join("、", request.Permissions.Select(ToChinesePermission))}";
        DeadlineText.Text = $"请在 {request.ExpiresAt.LocalDateTime:t} 前决定，关闭此窗口等同拒绝。";
    }

    public bool Accepted { get; private set; }

    private void Accept_Click(object sender, RoutedEventArgs e)
    {
        Accepted = true;
        DialogResult = true;
    }

    private void Reject_Click(object sender, RoutedEventArgs e)
    {
        Accepted = false;
        DialogResult = false;
    }

    private static string ToChinesePermission(string permission) => permission switch
    {
        "view" => "查看屏幕",
        "control" => "控制鼠标和键盘",
        "files.upload" => "上传文件",
        "files.download" => "下载文件",
        _ => permission,
    };
}
