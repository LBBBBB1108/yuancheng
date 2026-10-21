using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

using Microsoft.Win32;

using Yuancheng.Agent.Core;

namespace Yuancheng.Agent;

public partial class MainWindow : Window
{
    private readonly string _settingsDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Yuancheng");
    private bool _localAssistanceEnabled = true;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly DeviceConnectionClient _connectionClient = new();
    private readonly ReconnectBackoff _reconnectBackoff = new(
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(30));
    private CancellationTokenSource? _connectionCancellation;
    private Task? _connectionTask;
    private AgentBootstrapResult? _bootstrap;

    public MainWindow()
    {
        InitializeComponent();
        DeviceNameText.Text = Environment.MachineName;
#if PRODUCTION_BUILD
        Title = "公司远程协助";
        WelcomeTitle.Text = "远程协助";
        BuildLabel.Text = "公司远程协助";
#endif
        LoadSavedWelcomeImage();
        SetStatus("正在连接", "#9A7440");
        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private void ChooseImage_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择欢迎图片",
            Filter = "图片文件 (*.png;*.jpg;*.jpeg)|*.png;*.jpg;*.jpeg",
            Multiselect = false,
        };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        try
        {
            var bitmap = LoadValidatedBitmap(dialog.FileName);
            Directory.CreateDirectory(_settingsDirectory);
            File.WriteAllText(Path.Combine(_settingsDirectory, "welcome-image.txt"), dialog.FileName);
            ShowWelcomeImage(bitmap);
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or NotSupportedException)
        {
            MessageBox.Show(this, exception.Message, "无法读取欢迎图片", MessageBoxButton.OK, MessageBoxImage.Warning);
            ShowDefaultWelcome();
        }
    }

    private async void StopAssistance_Click(object sender, RoutedEventArgs e)
    {
        if (_localAssistanceEnabled)
        {
            _localAssistanceEnabled = false;
            _connectionCancellation?.Cancel();
            StopAssistanceButton.Content = "重新启用远控";
            SetStatus("已由本机停止", "#9A332D");
            return;
        }

        _localAssistanceEnabled = true;
        StopAssistanceButton.Content = "停止远控";
        if (_connectionTask is not null)
        {
            await _connectionTask;
        }
        StartConnectionLoop();
    }

    private void ExitClient_Click(object sender, RoutedEventArgs e) => Close();

    private void LoadSavedWelcomeImage()
    {
        try
        {
            var settingsPath = Path.Combine(_settingsDirectory, "welcome-image.txt");
            if (!File.Exists(settingsPath)) return;
            var imagePath = File.ReadAllText(settingsPath).Trim();
            ShowWelcomeImage(LoadValidatedBitmap(imagePath));
        }
        catch
        {
            ShowDefaultWelcome();
        }
    }

    private static BitmapImage LoadValidatedBitmap(string path)
    {
        var file = new FileInfo(path);
        if (!file.Exists || !WelcomeImageValidator.IsAllowedSize(file.Length))
        {
            throw new InvalidDataException("图片不存在、为空或超过 10MB。");
        }

        using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        Span<byte> header = stackalloc byte[8];
        if (stream.Read(header) < 3 || !WelcomeImageValidator.HasSupportedSignature(header))
        {
            throw new InvalidDataException("文件实际格式不是 PNG 或 JPG。");
        }
        stream.Position = 0;
        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = stream;
        bitmap.EndInit();
        bitmap.Freeze();
        if (!WelcomeImageValidator.AreAllowedDimensions(bitmap.PixelWidth, bitmap.PixelHeight))
        {
            throw new InvalidDataException("图片尺寸必须在 8192×8192 以内。");
        }
        return bitmap;
    }

    private void ShowWelcomeImage(BitmapImage bitmap)
    {
        WelcomeImage.Source = bitmap;
        WelcomeImage.Visibility = Visibility.Visible;
        DefaultWelcome.Visibility = Visibility.Collapsed;
    }

    private void ShowDefaultWelcome()
    {
        WelcomeImage.Source = null;
        WelcomeImage.Visibility = Visibility.Collapsed;
        DefaultWelcome.Visibility = Visibility.Visible;
    }

    private void SetStatus(string text, string color)
    {
        StatusText.Text = text;
        StatusDot.Fill = (Brush)new BrushConverter().ConvertFromString(color)!;
    }

    private void MainWindow_Loaded(object sender, RoutedEventArgs e) => StartConnectionLoop();

    private void StartConnectionLoop()
    {
        if (!_localAssistanceEnabled || _connectionTask is { IsCompleted: false }) return;
        _connectionCancellation?.Dispose();
        _connectionCancellation = new CancellationTokenSource();
        _connectionTask = RunConnectionLoopAsync(_connectionCancellation.Token);
    }

    private async Task RunConnectionLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            _bootstrap ??= await PrepareBootstrapWithRetryAsync(cancellationToken);

            var failedAttempt = 0;
            while (_localAssistanceEnabled && !cancellationToken.IsCancellationRequested)
            {
                try
                {
                    SetStatus(failedAttempt == 0 ? "正在连接" : "正在重新连接", "#9A7440");
                    var result = await _connectionClient.RunAsync(
                        _bootstrap.ServerUrl,
                        _bootstrap.Identity,
                        _bootstrap.Identity.DeviceId,
                        GetClientVersion(),
                        RuntimeInformation.OSDescription,
                        () =>
                        {
                            failedAttempt = 0;
                            SetStatus("已在线", "#2E7D4F");
                        },
                        cancellationToken);
                    if (result.Revoked)
                    {
                        _localAssistanceEnabled = false;
                        StopAssistanceButton.Content = "登记已撤销";
                        StopAssistanceButton.IsEnabled = false;
                        SetStatus("登记已撤销", "#9A332D");
                        return;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception)
                {
                    SetStatus("连接中断，稍后重试", "#9A7440");
                    var jitter = Random.Shared.NextDouble() * 0.4 - 0.2;
                    var retryDelay = _reconnectBackoff.GetDelay(failedAttempt++, jitter);
                    await Task.Delay(retryDelay, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (InvalidDataException exception)
        {
            SetStatus(exception.Message, "#9A332D");
        }
        catch (InvalidOperationException exception)
        {
            SetStatus(exception.Message, "#9A332D");
        }
    }

    private async Task<AgentBootstrapResult> PrepareBootstrapWithRetryAsync(
        CancellationToken cancellationToken)
    {
        var failedAttempt = 0;
        while (true)
        {
            try
            {
                return await CreateBootstrapService().PrepareAsync(
                    DateTimeOffset.UtcNow,
                    Environment.MachineName,
                    RuntimeInformation.OSDescription,
                    GetClientVersion(),
                    cancellationToken);
            }
            catch (Exception exception) when (
                exception is not InvalidDataException and not InvalidOperationException &&
                !cancellationToken.IsCancellationRequested)
            {
                SetStatus("登记连接失败，稍后重试", "#9A7440");
                var jitter = Random.Shared.NextDouble() * 0.4 - 0.2;
                await Task.Delay(
                    _reconnectBackoff.GetDelay(failedAttempt++, jitter),
                    cancellationToken);
            }
        }
    }

    private AgentBootstrapService CreateBootstrapService()
    {
        Directory.CreateDirectory(_settingsDirectory);
        return new AgentBootstrapService(
            Path.Combine(_settingsDirectory, "identity.json"),
            Path.Combine(_settingsDirectory, "agent-config.json"),
            Path.Combine(AppContext.BaseDirectory, "enrollment.json"),
            _httpClient);
    }

    private static string GetClientVersion() =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.1.0";

    private async void MainWindow_Closed(object? sender, EventArgs e)
    {
        _connectionCancellation?.Cancel();
        if (_connectionTask is not null)
        {
            await _connectionTask;
        }
        _bootstrap?.Dispose();
        _connectionCancellation?.Dispose();
        _httpClient.Dispose();
    }
}
