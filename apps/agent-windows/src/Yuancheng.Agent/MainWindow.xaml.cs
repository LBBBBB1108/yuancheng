using System.IO;
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

    private void StopAssistance_Click(object sender, RoutedEventArgs e)
    {
        if (!_localAssistanceEnabled)
        {
            return;
        }
        _localAssistanceEnabled = false;
        SetStatus("已由本机停止", "#9A332D");
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
}
