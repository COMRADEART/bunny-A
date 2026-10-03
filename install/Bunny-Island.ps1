param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$CredentialPath,
  [string]$DeploymentPath,
  [string]$PreferencePath,
  [switch]$SmokeTest,
  [switch]$SystemView,
  [switch]$LightView,
  [switch]$CollapsedView,
  [string]$ScreenshotDirectory,
  [scriptblock]$TestHook
)
$ErrorActionPreference = 'Stop'
if((Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release-manifest.json')) -and -not $CredentialPath) {throw 'Start the installed Island through Start-Bunny-Release.ps1. Installed state must be configured explicitly.'}
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
$bunnyCredentialPath = if($CredentialPath) {$CredentialPath} else {Join-Path $Root '.bunny-a/credentials.json'}
$bunnyDeploymentPath = if($DeploymentPath) {$DeploymentPath} else {Join-Path $Root '.bunny-a/deployment.json'}
function Open-BunnyDashboard([string]$Query='') {
  if(Test-Path -LiteralPath $bunnyDeploymentPath) {Start-Process ('http://127.0.0.1:8084/'+$Query)}
  elseif($CredentialPath) {throw 'The installed dashboard configuration is missing.'}
  elseif(Test-Path -LiteralPath (Join-Path $Root 'Bunny-Server.mjs')) {Start-Process ('http://127.0.0.1:8084/'+$Query)}
  else {& (Join-Path $Root 'scripts/start-bunny-dev.ps1');Start-Process ('http://127.0.0.1:8080/'+$Query)}
}
$bunnySnapshot = $null
$bunnySelectedId = $null
$bunnyExpanded = $false
$bunnySystemMode = [bool]$SystemView
$bunnyLight = $false
$bunnyPhoneMode = $false
$bunnyUpdating = $false
$bunnyLastError = $null
$bunnyTaskSignature = ''
$bunnyAnimate = -not $SmokeTest
$bunnyCollapsedHeight = 76
$bunnyExpandedHeight = 664
$bunnyDot = [string][char]0x00B7
$bunnyEllipsis = [string][char]0x2026

# Icon geometry: lucide, the same set the dashboard uses (24 x 24 grid, stroked).
$bunnyIcons = @{
  'hard-drive' = 'M 22,12 L 2,12 M 5.45,5.11 L 2,12 v 6 a 2,2 0 0 0 2,2 h 16 a 2,2 0 0 0 2,-2 v -6 l -3.45,-6.89 A 2,2 0 0 0 16.76,4 H 7.24 a 2,2 0 0 0 -1.79,1.11 Z M 6,16 L 6.01,16 M 10,16 L 10.01,16'
  'code' = 'M 16,18 L 22,12 L 16,6 M 8,6 L 2,12 L 8,18'
  'sparkles' = 'M 9.937,15.5 A 2,2 0 0 0 8.5,14.063 l -6.135,-1.582 a 0.5,0.5 0 0 1 0,-0.962 L 8.5,9.936 A 2,2 0 0 0 9.937,8.5 l 1.582,-6.135 a 0.5,0.5 0 0 1 0.963,0 L 14.063,8.5 A 2,2 0 0 0 15.5,9.937 l 6.135,1.581 a 0.5,0.5 0 0 1 0,0.964 L 15.5,14.063 a 2,2 0 0 0 -1.437,1.437 l -1.582,6.135 a 0.5,0.5 0 0 1 -0.963,0 Z M 20,3 v 4 M 22,5 h -4 M 4,17 v 2 M 5,18 H 3'
  'braces' = 'M 8,3 H 7 a 2,2 0 0 0 -2,2 v 5 a 2,2 0 0 1 -2,2 a 2,2 0 0 1 2,2 v 5 c 0,1.1 0.9,2 2,2 h 1 M 16,21 h 1 a 2,2 0 0 0 2,-2 v -5 c 0,-1.1 0.9,-2 2,-2 a 2,2 0 0 1 -2,-2 V 5 a 2,2 0 0 0 -2,-2 h -1'
  'bot' = 'M 12,8 V 4 H 8 M 6,8 H 18 A 2,2 0 0 1 20,10 V 18 A 2,2 0 0 1 18,20 H 6 A 2,2 0 0 1 4,18 V 10 A 2,2 0 0 1 6,8 Z M 2,14 h 2 M 20,14 h 2 M 15,13 v 2 M 9,13 v 2'
  'mouse-pointer-2' = 'M 4.037,4.688 a 0.495,0.495 0 0 1 0.651,-0.651 l 16,6.5 a 0.5,0.5 0 0 1 -0.063,0.947 l -6.124,1.58 a 2,2 0 0 0 -1.438,1.435 l -1.579,6.126 a 0.5,0.5 0 0 1 -0.947,0.063 Z'
  'x' = 'M 18,6 L 6,18 M 6,6 l 12,12'
  'chevron-up' = 'M 18,15 l -6,-6 l -6,6'
  'chevron-down' = 'M 6,9 l 6,6 l 6,-6'
  'smartphone' = 'M 7,2 H 17 A 2,2 0 0 1 19,4 V 20 A 2,2 0 0 1 17,22 H 7 A 2,2 0 0 1 5,20 V 4 A 2,2 0 0 1 7,2 Z M 12,18 h 0.01'
  'ellipsis' = 'M 11,12 A 1,1 0 1 0 13,12 A 1,1 0 1 0 11,12 M 18,12 A 1,1 0 1 0 20,12 A 1,1 0 1 0 18,12 M 4,12 A 1,1 0 1 0 6,12 A 1,1 0 1 0 4,12'
  'activity' = 'M 22,12 h -2.48 a 2,2 0 0 0 -1.93,1.46 l -2.35,8.36 a 0.25,0.25 0 0 1 -0.48,0 L 9.24,2.18 a 0.25,0.25 0 0 0 -0.48,0 l -2.35,8.36 A 2,2 0 0 1 4.49,12 H 2'
  'arrow-right' = 'M 5,12 h 14 M 12,5 l 7,7 l -7,7'
  'play' = 'M 6,3 L 20,12 L 6,21 L 6,3 Z'
  'square' = 'M 5,3 H 19 A 2,2 0 0 1 21,5 V 19 A 2,2 0 0 1 19,21 H 5 A 2,2 0 0 1 3,19 V 5 A 2,2 0 0 1 5,3 Z'
  'external-link' = 'M 15,3 h 6 v 6 M 10,14 L 21,3 M 18,13 v 6 a 2,2 0 0 1 -2,2 H 5 a 2,2 0 0 1 -2,-2 V 8 a 2,2 0 0 1 2,-2 h 6'
  'moon' = 'M 12,3 a 6,6 0 0 0 9,9 a 9,9 0 1 1 -9,-9 Z'
  'sun' = 'M 8,12 A 4,4 0 1 0 16,12 A 4,4 0 1 0 8,12 M 12,2 v 2 M 12,20 v 2 M 4.93,4.93 l 1.41,1.41 M 17.66,17.66 l 1.41,1.41 M 2,12 h 2 M 20,12 h 2 M 6.34,17.66 l -1.41,1.41 M 19.07,4.93 l -1.41,1.41'
  'circle-check' = 'M 2,12 A 10,10 0 1 0 22,12 A 10,10 0 1 0 2,12 M 9,12 l 2,2 l 4,-4'
  'circle-x' = 'M 2,12 A 10,10 0 1 0 22,12 A 10,10 0 1 0 2,12 M 15,9 l -6,6 M 9,9 l 6,6'
  'loader-circle' = 'M 21,12 a 9,9 0 1 1 -6.219,-8.56'
  'clock' = 'M 2,12 A 10,10 0 1 0 22,12 A 10,10 0 1 0 2,12 M 12,6 L 12,12 L 16,14'
  'file-text' = 'M 15,2 H 6 a 2,2 0 0 0 -2,2 v 16 a 2,2 0 0 0 2,2 h 12 a 2,2 0 0 0 2,-2 V 7 Z M 14,2 v 4 a 2,2 0 0 0 2,2 h 4 M 10,9 H 8 M 16,13 H 8 M 16,17 H 8'
}

[xml]$bunnyXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Bunny Island" Width="700" Height="76" WindowStyle="None" AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize" Topmost="True" ShowInTaskbar="False" UseLayoutRounding="True" SnapsToDevicePixels="True" FontFamily="Segoe UI Variable Text, Segoe UI Variable, Segoe UI" FontSize="13" TextOptions.TextFormattingMode="Display" Foreground="{DynamicResource BunnyText}">
 <Window.Resources>
  <SolidColorBrush x:Key="BunnyText" Color="#F5F5F7"/>
  <SolidColorBrush x:Key="BunnyMuted" Color="#A1A1A6"/>
  <SolidColorBrush x:Key="BunnyField" Color="#1FFFFFFF"/>
  <SolidColorBrush x:Key="BunnyHover" Color="#14FFFFFF"/>
  <SolidColorBrush x:Key="BunnyPopup" Color="#2C2C2E"/>
  <SolidColorBrush x:Key="BunnyAccent" Color="#0A84FF"/>
  <SolidColorBrush x:Key="BunnyAccentSoft" Color="#2E0A84FF"/>
  <SolidColorBrush x:Key="BunnyOnAccent" Color="#FFFFFF"/>
  <SolidColorBrush x:Key="BunnyPositive" Color="#30D158"/>
  <SolidColorBrush x:Key="BunnyPositiveSoft" Color="#2430D158"/>
  <SolidColorBrush x:Key="BunnyNegative" Color="#FF453A"/>
  <SolidColorBrush x:Key="BunnyNegativeSoft" Color="#24FF453A"/>
  <SolidColorBrush x:Key="BunnyWarning" Color="#FF9F0A"/>
  <SolidColorBrush x:Key="BunnyWarningSoft" Color="#24FF9F0A"/>
  <SolidColorBrush x:Key="BunnySep" Color="#1FFFFFFF"/>
  <SolidColorBrush x:Key="BunnySegment" Color="#636366"/>

  <Style x:Key="BunnyButtonBase" TargetType="Button">
   <Setter Property="Background" Value="Transparent"/>
   <Setter Property="Foreground" Value="{DynamicResource BunnyText}"/>
   <Setter Property="BorderThickness" Value="0"/>
   <Setter Property="Padding" Value="14,0"/>
   <Setter Property="MinHeight" Value="44"/>
   <Setter Property="FontWeight" Value="SemiBold"/>
   <Setter Property="Cursor" Value="Hand"/>
   <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
   <Setter Property="Template">
    <Setter.Value>
     <ControlTemplate TargetType="Button">
      <Grid x:Name="Root">
       <Border x:Name="Surface" Background="{TemplateBinding Background}" CornerRadius="17"/>
       <Border x:Name="Hover" Background="{DynamicResource BunnyHover}" CornerRadius="17" Opacity="0"/>
       <Border x:Name="Ring" BorderBrush="{DynamicResource BunnyAccent}" BorderThickness="2" CornerRadius="17" Opacity="0" IsHitTestVisible="False"/>
       <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" Margin="{TemplateBinding Padding}"/>
      </Grid>
      <ControlTemplate.Triggers>
       <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Hover" Property="Opacity" Value="1"/></Trigger>
       <Trigger Property="IsPressed" Value="True"><Setter TargetName="Root" Property="Opacity" Value="0.7"/></Trigger>
       <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Ring" Property="Opacity" Value="1"/></Trigger>
       <Trigger Property="IsEnabled" Value="False"><Setter TargetName="Root" Property="Opacity" Value="0.4"/></Trigger>
      </ControlTemplate.Triggers>
     </ControlTemplate>
    </Setter.Value>
   </Setter>
  </Style>
  <Style TargetType="Button" BasedOn="{StaticResource BunnyButtonBase}"/>
  <Style x:Key="IconButton" TargetType="Button" BasedOn="{StaticResource BunnyButtonBase}">
   <Setter Property="Width" Value="44"/>
   <Setter Property="Height" Value="44"/>
   <Setter Property="Padding" Value="0"/>
   <Setter Property="Foreground" Value="{DynamicResource BunnyMuted}"/>
  </Style>
  <Style x:Key="PrimaryButton" TargetType="Button" BasedOn="{StaticResource BunnyButtonBase}">
   <Setter Property="Background" Value="{DynamicResource BunnyAccent}"/>
   <Setter Property="Foreground" Value="{DynamicResource BunnyOnAccent}"/>
  </Style>
  <Style x:Key="SoftButton" TargetType="Button" BasedOn="{StaticResource BunnyButtonBase}">
   <Setter Property="Background" Value="{DynamicResource BunnyAccentSoft}"/>
   <Setter Property="Foreground" Value="{DynamicResource BunnyAccent}"/>
  </Style>
  <Style x:Key="DangerButton" TargetType="Button" BasedOn="{StaticResource BunnyButtonBase}">
   <Setter Property="Background" Value="{DynamicResource BunnyNegativeSoft}"/>
   <Setter Property="Foreground" Value="{DynamicResource BunnyNegative}"/>
  </Style>

  <Style TargetType="ScrollBar">
   <Setter Property="Width" Value="6"/>
   <Setter Property="MinWidth" Value="6"/>
   <Setter Property="Template">
    <Setter.Value>
     <ControlTemplate TargetType="ScrollBar">
      <Track x:Name="PART_Track" IsDirectionReversed="True" Orientation="Vertical">
       <Track.DecreaseRepeatButton><RepeatButton Command="ScrollBar.PageUpCommand"><RepeatButton.Template><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.DecreaseRepeatButton>
       <Track.Thumb><Thumb><Thumb.Template><ControlTemplate TargetType="Thumb"><Border Background="#66808088" CornerRadius="3" Margin="1,0"/></ControlTemplate></Thumb.Template></Thumb></Track.Thumb>
       <Track.IncreaseRepeatButton><RepeatButton Command="ScrollBar.PageDownCommand"><RepeatButton.Template><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></RepeatButton.Template></RepeatButton></Track.IncreaseRepeatButton>
      </Track>
     </ControlTemplate>
    </Setter.Value>
   </Setter>
  </Style>

  <Style TargetType="TextBox">
   <Setter Property="Foreground" Value="{DynamicResource BunnyText}"/>
   <Setter Property="Background" Value="{DynamicResource BunnyField}"/>
   <Setter Property="CaretBrush" Value="{DynamicResource BunnyAccent}"/>
   <Setter Property="Padding" Value="12,10"/>
   <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
   <Setter Property="Template">
    <Setter.Value>
     <ControlTemplate TargetType="TextBox">
      <Grid>
       <Border x:Name="Surface" Background="{TemplateBinding Background}" CornerRadius="14"/>
       <Border x:Name="Ring" BorderBrush="{DynamicResource BunnyAccent}" BorderThickness="2" CornerRadius="14" Opacity="0" IsHitTestVisible="False"/>
       <ScrollViewer x:Name="PART_ContentHost" Margin="{TemplateBinding Padding}"/>
       <Border Padding="{TemplateBinding Padding}" IsHitTestVisible="False"><TextBlock x:Name="Hint" Text="{TemplateBinding Tag}" Margin="2,0,0,0" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" Visibility="Collapsed"/></Border>
      </Grid>
      <ControlTemplate.Triggers>
       <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Ring" Property="Opacity" Value="1"/></Trigger>
       <Trigger Property="Text" Value=""><Setter TargetName="Hint" Property="Visibility" Value="Visible"/></Trigger>
      </ControlTemplate.Triggers>
     </ControlTemplate>
    </Setter.Value>
   </Setter>
  </Style>

  <Style TargetType="ListBoxItem">
   <Setter Property="Foreground" Value="{DynamicResource BunnyText}"/>
   <Setter Property="Padding" Value="8,7"/>
   <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
   <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
   <Setter Property="Template">
    <Setter.Value>
     <ControlTemplate TargetType="ListBoxItem">
      <Border x:Name="Row" CornerRadius="14" Padding="{TemplateBinding Padding}" Margin="0,1">
       <ContentPresenter/>
      </Border>
      <ControlTemplate.Triggers>
       <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Row" Property="Background" Value="{DynamicResource BunnyHover}"/></Trigger>
       <Trigger Property="IsSelected" Value="True"><Setter TargetName="Row" Property="Background" Value="{DynamicResource BunnyAccentSoft}"/></Trigger>
      </ControlTemplate.Triggers>
     </ControlTemplate>
    </Setter.Value>
   </Setter>
  </Style>
  <Style x:Key="BunnySegmentItem" TargetType="ListBoxItem">
   <Setter Property="Foreground" Value="{DynamicResource BunnyText}"/>
   <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
   <Setter Property="Cursor" Value="Hand"/>
   <Setter Property="Template">
    <Setter.Value>
     <ControlTemplate TargetType="ListBoxItem">
      <Border x:Name="Seg" CornerRadius="9" Padding="11,6">
       <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
      </Border>
      <ControlTemplate.Triggers>
       <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Seg" Property="Background" Value="{DynamicResource BunnyHover}"/></Trigger>
       <Trigger Property="IsSelected" Value="True"><Setter TargetName="Seg" Property="Background" Value="{DynamicResource BunnySegment}"/><Setter Property="FontWeight" Value="SemiBold"/></Trigger>
      </ControlTemplate.Triggers>
     </ControlTemplate>
    </Setter.Value>
   </Setter>
  </Style>
 </Window.Resources>
 <Border x:Name="Glass" Background="#F51C1C1E" CornerRadius="26" BorderBrush="{DynamicResource BunnySep}" BorderThickness="1" Padding="14,10" Margin="10">
  <Border.Effect><DropShadowEffect BlurRadius="26" ShadowDepth="6" Direction="270" Opacity="0.35" Color="Black"/></Border.Effect>
  <StackPanel>
   <DockPanel LastChildFill="True" Height="40">
    <Button x:Name="CloseButton" DockPanel.Dock="Right" Style="{StaticResource IconButton}" ToolTip="Close Island; Host and tasks keep running" AutomationProperties.Name="Close Island"/>
    <Button x:Name="ExpandButton" DockPanel.Dock="Right" Style="{StaticResource IconButton}" ToolTip="Expand" AutomationProperties.Name="Expand or collapse"/>
    <Button x:Name="PhoneButton" DockPanel.Dock="Right" Style="{StaticResource IconButton}" ToolTip="Connect a phone" AutomationProperties.Name="Connect a phone"/>
    <Button x:Name="ExtrasButton" DockPanel.Dock="Right" Style="{StaticResource IconButton}" ToolTip="Other detected integrations" AutomationProperties.Name="Other integrations"/>
    <Button x:Name="SystemButton" DockPanel.Dock="Right" Style="{StaticResource IconButton}" ToolTip="System" AutomationProperties.Name="System"/>
    <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="2,0,16,0">
     <Border x:Name="BrandTile" Width="32" Height="32" CornerRadius="9" Margin="0,0,10,0" VerticalAlignment="Center">
      <Path x:Name="BrandMark" Data="M10 17C7 13 7 5 10 5S14 11 14 15H18C18 11 19 5 22 5S25 13 22 17C25 19 25 24 22 26C19 29 13 29 10 26C7 24 7 19 10 17Z M10.8 21 A1.2 1.2 0 1 0 13.2 21 A1.2 1.2 0 1 0 10.8 21 M18.8 21 A1.2 1.2 0 1 0 21.2 21 A1.2 1.2 0 1 0 18.8 21" Fill="White" Width="17" Height="22" Stretch="Uniform" HorizontalAlignment="Center" VerticalAlignment="Center"/>
     </Border>
     <TextBlock x:Name="Brand" Text="Bunny-A" FontWeight="SemiBold" FontSize="15" VerticalAlignment="Center"/>
     <Border x:Name="ActiveBadge" Visibility="Collapsed" Background="{DynamicResource BunnyAccentSoft}" CornerRadius="10" Padding="8,2" Margin="8,0,0,0" VerticalAlignment="Center"><TextBlock x:Name="ActiveText" Foreground="{DynamicResource BunnyAccent}" FontSize="11.5" FontWeight="SemiBold"/></Border>
    </StackPanel>
    <StackPanel x:Name="Providers" Orientation="Horizontal" VerticalAlignment="Center"/>
   </DockPanel>
   <ScrollViewer x:Name="Details" Visibility="Collapsed" Height="574" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled" Margin="0,12,0,0">
    <StackPanel Margin="2,0,12,0">
     <StackPanel Orientation="Horizontal" Margin="2,0,0,12">
      <Ellipse x:Name="PresenceDot" Width="8" Height="8" Fill="{DynamicResource BunnyPositive}" VerticalAlignment="Center" Margin="0,1,8,0"/>
      <TextBlock x:Name="Presence" Text="Connecting to Host" Foreground="{DynamicResource BunnyMuted}" FontSize="12.5"/>
     </StackPanel>
     <StackPanel x:Name="Graphs" Visibility="Collapsed"/>
     <ListBox x:Name="Tasks" Height="158" Background="Transparent" Foreground="{DynamicResource BunnyText}" BorderThickness="0" ScrollViewer.HorizontalScrollBarVisibility="Disabled"/>
     <Border Height="1" Background="{DynamicResource BunnySep}" Margin="0,12,0,14"/>
     <TextBlock x:Name="TaskTitle" FontSize="15" FontWeight="SemiBold" TextWrapping="Wrap" Margin="2,0,0,3"/>
     <TextBlock x:Name="TaskDetail" Text="Select a task to inspect real activity." Foreground="{DynamicResource BunnyMuted}" FontSize="12.5" TextWrapping="Wrap" Margin="2,0,0,10"/>
     <ProgressBar x:Name="TaskProgress" Height="4" Margin="2,0,2,8" Minimum="0" Maximum="1" Value="0" Visibility="Collapsed" BorderThickness="0" Background="{DynamicResource BunnyField}" Foreground="{DynamicResource BunnyAccent}" AutomationProperties.Name="Task progress"/>
     <TextBox x:Name="Output" Height="86" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" FontFamily="Cascadia Mono, Consolas" FontSize="12"/>
     <TextBlock x:Name="PromptLabel" Text="New task" Foreground="{DynamicResource BunnyMuted}" FontSize="12" FontWeight="SemiBold" Margin="2,16,0,6"/>
     <TextBox x:Name="Prompt" Tag="Describe the task, the outcome you want, and any constraints&#8230;" Height="68" AcceptsReturn="True" TextWrapping="Wrap" Margin="0,0,0,12" ToolTip="Describe a new task; routing requires review before launch. Ctrl+Enter routes it."/>
     <DockPanel x:Name="TaskActions" LastChildFill="False">
      <Border DockPanel.Dock="Left" CornerRadius="11" Background="{DynamicResource BunnyField}" Padding="2" VerticalAlignment="Center" Margin="0,0,10,0">
       <ListBox x:Name="Mode" SelectedIndex="1" Background="Transparent" BorderThickness="0" ScrollViewer.HorizontalScrollBarVisibility="Disabled" ScrollViewer.VerticalScrollBarVisibility="Disabled" AutomationProperties.Name="Routing approach">
        <ListBox.ItemsPanel><ItemsPanelTemplate><UniformGrid Rows="1"/></ItemsPanelTemplate></ListBox.ItemsPanel>
        <ListBoxItem Style="{StaticResource BunnySegmentItem}" Content="Fast" ToolTip="Prioritize speed"/>
        <ListBoxItem Style="{StaticResource BunnySegmentItem}" Content="Balanced" ToolTip="Fit, speed and privacy"/>
        <ListBoxItem Style="{StaticResource BunnySegmentItem}" Content="Deep" ToolTip="Complex work"/>
       </ListBox>
      </Border>
      <Button x:Name="RouteButton" Style="{StaticResource PrimaryButton}" Margin="0,0,6,0"/>
      <Button x:Name="ApproveButton" Style="{StaticResource SoftButton}" IsEnabled="False" Margin="0,0,6,0"/>
      <Button x:Name="StopButton" Style="{StaticResource DangerButton}" IsEnabled="False" Margin="0,0,6,0"/>
     </DockPanel>
     <DockPanel Margin="0,14,0,6">
      <Button x:Name="OpenButton" DockPanel.Dock="Left" Style="{StaticResource SoftButton}"/>
      <Button x:Name="ThemeButton" DockPanel.Dock="Left" Style="{StaticResource IconButton}" Margin="6,0,0,0" ToolTip="Switch between light and dark" AutomationProperties.Name="Switch light or dark"/>
      <Button x:Name="TerminalButton" DockPanel.Dock="Left" Content="Terminal" Foreground="{DynamicResource BunnyMuted}" Margin="2,0,12,0" IsEnabled="False" ToolTipService.ShowOnDisabled="True" ToolTip="Select a task to check terminal attachment"/>
      <TextBlock x:Name="Notice" Foreground="{DynamicResource BunnyMuted}" FontSize="12" TextWrapping="Wrap" VerticalAlignment="Center"/>
     </DockPanel>
    </StackPanel>
   </ScrollViewer>
  </StackPanel>
 </Border>
</Window>
'@
$bunnyWindow = [Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($bunnyXaml))
$bunnyNames = @('Glass','BrandTile','BrandMark','Brand','ActiveBadge','ActiveText','Providers','Graphs','CloseButton','ExpandButton','PhoneButton','ExtrasButton','SystemButton','Details','PresenceDot','Presence','Tasks','TaskTitle','TaskDetail','TaskProgress','Output','Prompt','PromptLabel','TaskActions','Mode','RouteButton','ApproveButton','StopButton','TerminalButton','OpenButton','ThemeButton','Notice')
$bunnyControls = @{}
foreach ($name in $bunnyNames) { $bunnyControls[$name] = $bunnyWindow.FindName($name) }
$bunnyWindow.Left = ([System.Windows.SystemParameters]::PrimaryScreenWidth - $bunnyWindow.Width) / 2
$bunnyWindow.Top = 4

# ---------- helpers ----------
function Set-BunnyRef($Element, $Property, [string]$Key) { $Element.SetResourceReference($Property, $Key) }
function New-BunnyBrush([string]$Hex) { [Windows.Media.SolidColorBrush]::new([Windows.Media.ColorConverter]::ConvertFromString($Hex)) }
function New-BunnyIcon([string]$Name, [double]$Size = 16) {
  $path = [Windows.Shapes.Path]::new()
  $path.Data = [Windows.Media.Geometry]::Parse($bunnyIcons[$Name])
  $path.StrokeThickness = 2
  $path.StrokeStartLineCap = 'Round'; $path.StrokeEndLineCap = 'Round'; $path.StrokeLineJoin = 'Round'
  $canvas = [Windows.Controls.Canvas]::new(); $canvas.Width = 24; $canvas.Height = 24
  [void]$canvas.Children.Add($path)
  $box = [Windows.Controls.Viewbox]::new(); $box.Width = $Size; $box.Height = $Size; $box.Child = $canvas; $box.IsHitTestVisible = $false
  $box.Tag = $path
  return $box
}
function Bind-BunnyIconToButton($Box, $Button) {
  $binding = [Windows.Data.Binding]::new('Foreground')
  $binding.RelativeSource = [Windows.Data.RelativeSource]::new([Windows.Data.RelativeSourceMode]::FindAncestor, [Windows.Controls.Button], 1)
  [void]$Box.Tag.SetBinding([Windows.Shapes.Shape]::StrokeProperty, $binding)
}
function Set-BunnyButton($Button, [string]$Label, [string]$Icon, [double]$IconSize = 15) {
  $stack = [Windows.Controls.StackPanel]::new(); $stack.Orientation = 'Horizontal'; $stack.VerticalAlignment = 'Center'
  if ($Icon) {
    $box = New-BunnyIcon $Icon $IconSize
    Bind-BunnyIconToButton $box $Button
    if ($Label) { $box.Margin = '0,0,7,0' }
    [void]$stack.Children.Add($box)
  }
  if ($Label) { $text = [Windows.Controls.TextBlock]::new(); $text.Text = $Label; $text.VerticalAlignment = 'Center'; [void]$stack.Children.Add($text) }
  $Button.Content = $stack
}
$bunnyTiles = @{
  ollama = @('#5E5E63', '#2C2C2E', 'hard-drive'); codex = @('#34C759', '#248A3D', 'code'); claude = @('#FF9F4A', '#D9640A', 'sparkles')
  opencode = @('#64D2FF', '#0A84C6', 'braces'); cline = @('#BF5AF2', '#8944AB', 'bot'); cursor = @('#7D7AFF', '#4A47C9', 'mouse-pointer-2')
}
function New-BunnyTile([string]$Id, [double]$Size) {
  $spec = $bunnyTiles[$Id]; if (-not $spec) { $spec = @('#8E8E93', '#636366', 'code') }
  $tile = [Windows.Controls.Border]::new(); $tile.Width = $Size; $tile.Height = $Size; $tile.CornerRadius = [Windows.CornerRadius]::new($Size * 0.28)
  $gradient = [Windows.Media.LinearGradientBrush]::new(); $gradient.StartPoint = '0,0'; $gradient.EndPoint = '0,1'
  [void]$gradient.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString($spec[0]), 0))
  [void]$gradient.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString($spec[1]), 1))
  $tile.Background = $gradient
  $icon = New-BunnyIcon $spec[2] ($Size * 0.56); $icon.Tag.Stroke = [Windows.Media.Brushes]::White
  $icon.HorizontalAlignment = 'Center'; $icon.VerticalAlignment = 'Center'
  $tile.Child = $icon
  return $tile
}
function Get-BunnyStateInfo([string]$State) {
  switch ($State) {
    'completed' { return @{ Label = 'Completed'; Soft = 'BunnyPositiveSoft'; Ink = 'BunnyPositive'; Icon = 'circle-check' } }
    'failed' { return @{ Label = 'Failed'; Soft = 'BunnyNegativeSoft'; Ink = 'BunnyNegative'; Icon = 'circle-x' } }
    'running' { return @{ Label = 'Running'; Soft = 'BunnyAccentSoft'; Ink = 'BunnyAccent'; Icon = 'loader-circle' } }
    'launching' { return @{ Label = 'Starting'; Soft = 'BunnyAccentSoft'; Ink = 'BunnyAccent'; Icon = 'loader-circle' } }
    'verifying' { return @{ Label = 'Verifying'; Soft = 'BunnyAccentSoft'; Ink = 'BunnyAccent'; Icon = 'loader-circle' } }
    'waiting_for_approval' { return @{ Label = 'Needs approval'; Soft = 'BunnyWarningSoft'; Ink = 'BunnyWarning'; Icon = 'clock' } }
    'waiting_for_input' { return @{ Label = 'Needs input'; Soft = 'BunnyWarningSoft'; Ink = 'BunnyWarning'; Icon = 'clock' } }
    'waiting_for_agent_approval' { return @{ Label = 'Agent approval needed'; Soft = 'BunnyWarningSoft'; Ink = 'BunnyWarning'; Icon = 'clock' } }
    'stopped' { return @{ Label = 'Stopped'; Soft = 'BunnyField'; Ink = 'BunnyMuted'; Icon = 'square' } }
    default { return @{ Label = (Get-Culture).TextInfo.ToTitleCase($State.Replace('_', ' ')); Soft = 'BunnyField'; Ink = 'BunnyMuted'; Icon = 'file-text' } }
  }
}
function Get-BunnyElapsed($Task) {
  if (-not $Task.startedAt) { return 'Not started' }
  $end = if ($Task.finishedAt) { $Task.finishedAt } else { [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
  $seconds = [Math]::Max(0, [int](($end - $Task.startedAt) / 1000))
  return ('{0}m {1:00}s' -f [Math]::Floor($seconds / 60), ($seconds % 60))
}
function Get-BunnyProviderName([string]$Id) {
  $provider = @($bunnySnapshot.providers | Where-Object id -eq $Id) | Select-Object -First 1
  if ($provider) { return $provider.name }
  return $Id
}
function Set-BunnyDetail([string]$Title, [string]$Text) {
  $bunnyControls.TaskTitle.Text = $Title
  $bunnyControls.TaskTitle.Visibility = if ($Title) { 'Visible' } else { 'Collapsed' }
  $bunnyControls.TaskDetail.Text = $Text
}
function Find-BunnyScrollViewer($Element) {
  if ($Element -is [Windows.Controls.ScrollViewer]) { return $Element }
  $count = [Windows.Media.VisualTreeHelper]::GetChildrenCount($Element)
  for ($index = 0; $index -lt $count; $index++) {
    $found = Find-BunnyScrollViewer ([Windows.Media.VisualTreeHelper]::GetChild($Element, $index))
    if ($found) { return $found }
  }
  return $null
}

# ---------- host access ----------
function Get-BunnyError($Record) {
  # Windows PowerShell 5.1 often leaves ErrorDetails empty; the Host's JSON reason is still in the response stream.
  $text = $null
  if ($Record.ErrorDetails -and $Record.ErrorDetails.Message) { $text = $Record.ErrorDetails.Message }
  elseif ($Record.Exception.Response) {
    try { $reader = New-Object IO.StreamReader($Record.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8); $text = $reader.ReadToEnd(); $reader.Dispose() } catch { }
  }
  if ($text) { try { $body = $text | ConvertFrom-Json; if ($body.error) { return [string]$body.error } } catch { } }
  return $Record.Exception.Message
}
function Invoke-Bunny([string]$Action, $Data) {
  $credentials = Get-Content -LiteralPath $bunnyCredentialPath -Raw | ConvertFrom-Json
  $headers = @{ Authorization = 'Bearer ' + $credentials.token }
  $url = 'http://127.0.0.1:' + $credentials.port
  if ($Action) { return Invoke-RestMethod ($url + '/command') -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ action = $Action; data = $Data } | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 8 }
  return Invoke-RestMethod ($url + '/state') -Headers $headers -TimeoutSec 2
}

# ---------- window sizing ----------
function Set-BunnyHeight([double]$Height, [scriptblock]$OnDone) {
  if (-not $bunnyAnimate) {
    $bunnyWindow.BeginAnimation([Windows.Window]::HeightProperty, $null)
    $bunnyWindow.Height = $Height
    if ($OnDone) { . $OnDone }
    return
  }
  $animation = [Windows.Media.Animation.DoubleAnimation]::new()
  $animation.To = $Height
  $animation.Duration = [Windows.Duration]::new([TimeSpan]::FromMilliseconds(300))
  $animation.EasingFunction = [Windows.Media.Animation.CubicEase]::new()
  if ($OnDone) { $animation.add_Completed($OnDone) }
  $bunnyWindow.BeginAnimation([Windows.Window]::HeightProperty, $animation)
}
function Expand-Bunny {
  if ($script:bunnyExpanded) { return }
  $script:bunnyExpanded = $true
  $bunnyControls.Details.Visibility = 'Visible'
  Set-BunnyHeight $bunnyExpandedHeight
  Set-BunnyButton $bunnyControls.ExpandButton '' 'chevron-up' 17
  $bunnyControls.ExpandButton.ToolTip = 'Collapse'
}
function Close-BunnyDetails {
  if (-not $script:bunnyExpanded -and $bunnyControls.Details.Visibility -eq 'Collapsed') { return }
  $script:bunnyExpanded = $false
  Set-BunnyButton $bunnyControls.ExpandButton '' 'chevron-down' 17
  $bunnyControls.ExpandButton.ToolTip = 'Expand'
  Set-BunnyHeight $bunnyCollapsedHeight { if (-not $script:bunnyExpanded) { $bunnyControls.Details.Visibility = 'Collapsed' } }
}

# ---------- rendering ----------
function Update-BunnyChrome {
  if ($bunnySystemMode) { Set-BunnyRef $bunnyControls.SystemButton ([Windows.Controls.Control]::ForegroundProperty) 'BunnyAccent' } else { $bunnyControls.SystemButton.ClearValue([Windows.Controls.Control]::ForegroundProperty) }
  if ($bunnyPhoneMode) { Set-BunnyRef $bunnyControls.PhoneButton ([Windows.Controls.Control]::ForegroundProperty) 'BunnyAccent' } else { $bunnyControls.PhoneButton.ClearValue([Windows.Controls.Control]::ForegroundProperty) }
}
function Update-BunnyRouteState {
  $bunnyControls.RouteButton.IsEnabled = (-not $bunnySystemMode) -and ($bunnyControls.Prompt.Text.Trim().Length -gt 0)
}
function Add-BunnyRing($Grid, [double]$Radius, [double]$Percent, [string]$Key) {
  $center = 19
  $track = [Windows.Shapes.Ellipse]::new(); $track.Width = $Radius * 2; $track.Height = $Radius * 2; $track.Stroke = (New-BunnyBrush '#44808088'); $track.StrokeThickness = 2
  [void]$Grid.Children.Add($track)
  if ($Percent -le 0) { return }
  if ($Percent -ge 100) { Set-BunnyRef $track ([Windows.Shapes.Shape]::StrokeProperty) $Key; return }
  $angle = $Percent / 100 * 2 * [Math]::PI
  $figure = [Windows.Media.PathFigure]::new(); $figure.StartPoint = [Windows.Point]::new($center, $center - $Radius)
  $arc = [Windows.Media.ArcSegment]::new(); $arc.Point = [Windows.Point]::new($center + $Radius * [Math]::Sin($angle), $center - $Radius * [Math]::Cos($angle)); $arc.Size = [Windows.Size]::new($Radius, $Radius); $arc.IsLargeArc = $Percent -gt 50; $arc.SweepDirection = 'Clockwise'
  [void]$figure.Segments.Add($arc)
  $geometry = [Windows.Media.PathGeometry]::new(); [void]$geometry.Figures.Add($figure)
  $arcPath = [Windows.Shapes.Path]::new(); $arcPath.Data = $geometry; $arcPath.StrokeThickness = 2; $arcPath.StrokeStartLineCap = 'Round'; $arcPath.StrokeEndLineCap = 'Round'
  Set-BunnyRef $arcPath ([Windows.Shapes.Shape]::StrokeProperty) $Key
  [void]$Grid.Children.Add($arcPath)
}
function Draw-BunnyProviders {
  $bunnyControls.Providers.Children.Clear()
  $items = @($bunnySnapshot.providers | Where-Object { $_.installed -and -not $_.extension })
  foreach ($provider in $items) {
    $row = [Windows.Controls.StackPanel]::new(); $row.Orientation = 'Horizontal'; $row.Margin = '0,0,12,0'
    $icon = [Windows.Controls.Grid]::new(); $icon.Width = 38; $icon.Height = 38
    $windows = @($provider.usageWindows | Where-Object { $null -ne $_.usedPercent })
    # Inner ring = short window, outer ring = weekly. One exposed window draws one ring; none draws no ring.
    $short = @($windows | Where-Object { $_.kind -eq 'short' -or ((-not $_.kind) -and $_.label -like '*hour*') }) | Select-Object -First 1
    $weekly = @($windows | Where-Object { $_.kind -eq 'weekly' -or ((-not $_.kind) -and $_.label -eq 'Weekly') }) | Select-Object -First 1
    $outer = if ($weekly) { $weekly } elseif ($short) { $short } elseif ($windows.Count) { $windows[0] } else { $null }
    $inner = if ($weekly -and $short) { $short } else { $null }
    if ($outer) { Add-BunnyRing $icon 18 $outer.usedPercent 'BunnyAccent' }
    if ($inner) { Add-BunnyRing $icon 14.5 $inner.usedPercent 'BunnyPositive' }
    $tile = New-BunnyTile $provider.id $(if ($outer) { 24 } else { 28 })
    $tile.HorizontalAlignment = 'Center'; $tile.VerticalAlignment = 'Center'
    [void]$icon.Children.Add($tile)
    $statusKey = switch ($provider.availability) { 'ready' { 'BunnyPositive' } 'busy' { 'BunnyAccent' } 'rate_limited' { 'BunnyWarning' } 'authentication_required' { 'BunnyWarning' } default { 'BunnyMuted' } }
    $dot = [Windows.Shapes.Ellipse]::new(); $dot.Width = 10; $dot.Height = 10; $dot.HorizontalAlignment = 'Right'; $dot.VerticalAlignment = 'Bottom'; $dot.Margin = '0,0,1,1'
    Set-BunnyRef $dot ([Windows.Shapes.Shape]::FillProperty) $statusKey
    $dot.Stroke = $bunnyControls.Glass.Background; $dot.StrokeThickness = 2
    [void]$icon.Children.Add($dot)
    [void]$row.Children.Add($icon)
    if ($items.Count -le 3) {
      $name = [Windows.Controls.TextBlock]::new(); $name.Text = if ($provider.id -eq 'claude') { 'Claude' } else { $provider.name }; $name.FontSize = 12; $name.Margin = '5,0,0,0'; $name.VerticalAlignment = 'Center'
      Set-BunnyRef $name ([Windows.Controls.TextBlock]::ForegroundProperty) 'BunnyMuted'
      [void]$row.Children.Add($name)
    }
    $usage = if ($windows.Count) {
      $when = if ($provider.usageObservedAt) { ' (as of ' + [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$provider.usageObservedAt).ToLocalTime().ToString('g') + ')' } else { '' }
      $provider.usage_note + $when + "`n" + (@($windows | ForEach-Object { $_.label + ': ' + $_.usedPercent + '% used; resets ' + $(if ($_.resetsAt) { [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$_.resetsAt).ToLocalTime().ToString('g') } else { 'time unavailable' }) }) -join "`n")
    } else { 'Usage unavailable' }
    $observed = if ($provider.observed -and $provider.observed.tasks) { 'Observed by Bunny-A (not provider quota): ' + $provider.observed.tasks + ' tasks, ' + $provider.observed.completed + ' completed, ' + [Math]::Round($provider.observed.runtimeMs / 1000) + ' s runtime, ' + $provider.observed.inputTokens + ' input / ' + $provider.observed.outputTokens + ' output tokens reported' } else { 'Observed by Bunny-A: no tasks yet' }
    $row.ToolTip = $provider.name + ' ' + $bunnyDot + ' ' + $provider.availability.Replace('_', ' ') + "`n" + $usage + "`n" + $observed + "`nActive tasks: " + $provider.active_jobs
    [void]$bunnyControls.Providers.Children.Add($row)
  }
}
function Draw-BunnyGraph([string]$Label, $Values, [string]$Unit) {
  $width = 626; $height = 56
  $header = [Windows.Controls.DockPanel]::new(); $header.Margin = '2,10,2,5'
  $latest = @($Values | Where-Object { $null -ne $_ }) | Select-Object -Last 1
  $value = [Windows.Controls.TextBlock]::new(); $value.Text = if ($null -ne $latest) { ([Math]::Round([double]$latest, 1)).ToString() + $Unit } else { 'Unavailable' }; $value.FontWeight = 'SemiBold'; $value.FontSize = 12.5
  [Windows.Controls.DockPanel]::SetDock($value, 'Right'); [void]$header.Children.Add($value)
  $title = [Windows.Controls.TextBlock]::new(); $title.Text = $Label; $title.FontSize = 12.5; Set-BunnyRef $title ([Windows.Controls.TextBlock]::ForegroundProperty) 'BunnyMuted'; [void]$header.Children.Add($title)
  [void]$bunnyControls.Graphs.Children.Add($header)
  $frame = [Windows.Controls.Border]::new(); $frame.CornerRadius = [Windows.CornerRadius]::new(14); $frame.Width = $width; $frame.Height = $height; $frame.HorizontalAlignment = 'Left'; $frame.ClipToBounds = $true
  Set-BunnyRef $frame ([Windows.Controls.Border]::BackgroundProperty) 'BunnyField'
  $canvas = [Windows.Controls.Canvas]::new(); $canvas.Width = $width; $canvas.Height = $height
  $points = [Windows.Media.PointCollection]::new(); $count = @($Values).Count
  for ($index = 0; $index -lt $count; $index++) {
    if ($null -ne $Values[$index]) { [void]$points.Add([Windows.Point]::new($index * $width / [Math]::Max(1, $count - 1), ($height - 6) - [Math]::Max(0, [Math]::Min(100, [double]$Values[$index])) * ($height - 14) / 100)) }
  }
  if ($points.Count -gt 1) {
    $area = [Windows.Media.PointCollection]::new(); [void]$area.Add([Windows.Point]::new($points[0].X, $height))
    foreach ($point in $points) { [void]$area.Add($point) }
    [void]$area.Add([Windows.Point]::new($points[$points.Count - 1].X, $height))
    $fill = [Windows.Shapes.Polygon]::new(); $fill.Points = $area; Set-BunnyRef $fill ([Windows.Shapes.Shape]::FillProperty) 'BunnyAccentSoft'; [void]$canvas.Children.Add($fill)
    $line = [Windows.Shapes.Polyline]::new(); $line.Points = $points; $line.StrokeThickness = 2; $line.StrokeLineJoin = 'Round'; Set-BunnyRef $line ([Windows.Shapes.Shape]::StrokeProperty) 'BunnyAccent'; [void]$canvas.Children.Add($line)
  }
  $frame.Child = $canvas
  [void]$bunnyControls.Graphs.Children.Add($frame)
}
function New-BunnyTaskRow($Task) {
  $info = Get-BunnyStateInfo $Task.state
  $grid = [Windows.Controls.Grid]::new()
  $first = [Windows.Controls.ColumnDefinition]::new(); $first.Width = [Windows.GridLength]::new(40)
  $second = [Windows.Controls.ColumnDefinition]::new(); $second.Width = [Windows.GridLength]::new(1, [Windows.GridUnitType]::Star)
  $third = [Windows.Controls.ColumnDefinition]::new(); $third.Width = [Windows.GridLength]::Auto
  [void]$grid.ColumnDefinitions.Add($first); [void]$grid.ColumnDefinitions.Add($second); [void]$grid.ColumnDefinitions.Add($third)
  $disc = [Windows.Controls.Border]::new(); $disc.Width = 30; $disc.Height = 30; $disc.CornerRadius = [Windows.CornerRadius]::new(15); $disc.HorizontalAlignment = 'Left'; $disc.VerticalAlignment = 'Center'
  Set-BunnyRef $disc ([Windows.Controls.Border]::BackgroundProperty) $info.Soft
  $glyph = New-BunnyIcon $info.Icon 15; Set-BunnyRef $glyph.Tag ([Windows.Shapes.Shape]::StrokeProperty) $info.Ink; $glyph.HorizontalAlignment = 'Center'; $glyph.VerticalAlignment = 'Center'
  $disc.Child = $glyph
  [void]$grid.Children.Add($disc)
  $stack = [Windows.Controls.StackPanel]::new(); $stack.VerticalAlignment = 'Center'; $stack.Margin = '0,0,10,0'
  [Windows.Controls.Grid]::SetColumn($stack, 1)
  $title = [Windows.Controls.TextBlock]::new(); $title.Text = $Task.title; $title.FontWeight = 'Medium'; $title.TextTrimming = 'CharacterEllipsis'
  $mode = if ($Task.mode) { (Get-Culture).TextInfo.ToTitleCase([string]$Task.mode) } else { '' }
  $sub = [Windows.Controls.TextBlock]::new(); $sub.Text = (Get-BunnyProviderName $Task.provider) + ' ' + $bunnyDot + ' ' + $mode + ' ' + $bunnyDot + ' ' + (Get-BunnyElapsed $Task); $sub.FontSize = 11.5; $sub.TextTrimming = 'CharacterEllipsis'
  Set-BunnyRef $sub ([Windows.Controls.TextBlock]::ForegroundProperty) 'BunnyMuted'
  [void]$stack.Children.Add($title); [void]$stack.Children.Add($sub)
  [void]$grid.Children.Add($stack)
  $capsule = [Windows.Controls.Border]::new(); $capsule.CornerRadius = [Windows.CornerRadius]::new(11); $capsule.Padding = '10,3'; $capsule.VerticalAlignment = 'Center'
  Set-BunnyRef $capsule ([Windows.Controls.Border]::BackgroundProperty) $info.Soft
  [Windows.Controls.Grid]::SetColumn($capsule, 2)
  $label = [Windows.Controls.TextBlock]::new(); $label.Text = $info.Label; $label.FontSize = 11.5; $label.FontWeight = 'SemiBold'
  Set-BunnyRef $label ([Windows.Controls.TextBlock]::ForegroundProperty) $info.Ink
  $capsule.Child = $label
  [void]$grid.Children.Add($capsule)
  return $grid
}
function Show-BunnyTask {
  if ($bunnyPhoneMode) { return }
  if (-not $bunnySnapshot) { return }
  $task = @($bunnySnapshot.tasks | Where-Object id -eq $bunnySelectedId) | Select-Object -First 1
  $bunnyControls.ApproveButton.IsEnabled = $null -ne $task -and $task.state -eq 'waiting_for_approval'
  $bunnyControls.StopButton.IsEnabled = $null -ne $task -and $task.state -notin @('completed', 'failed', 'stopped')
  $bar = $bunnyControls.TaskProgress
  $bunnyControls.TerminalButton.IsEnabled = $null -ne $task
  if ($task) {
    $info = Get-BunnyStateInfo $task.state
    $latest = $task.latestEvent
    $live = $task.state -in @('launching', 'running', 'verifying')
    $who = if ($latest -and $latest.actor -eq 'bunny') { 'Bunny-A' } else { Get-BunnyProviderName $task.provider }
    $activity = if ($live -and $latest -and $latest.label) { $latest.label } elseif ($live) { 'Working' + $bunnyEllipsis } else { $info.Label }
    $meta = $who + ' ' + $bunnyDot + ' ' + $activity + ' ' + $bunnyDot + ' ' + (Get-BunnyElapsed $task)
    $plan = $task.progress
    $planned = $plan -and $plan.kind -eq 'determinate' -and $plan.total -gt 0
    if ($planned) { $meta += ' ' + $bunnyDot + ' ' + $plan.completed + ' / ' + $plan.total + ' steps complete' }
    # One activity line, trimmed to the panel width; the full text is in the tooltip.
    $line = if ($latest -and $latest.detail) { ($latest.detail -split "`r?`n")[0] } elseif ($planned -and $plan.current) { $plan.current } else { '' }
    if ($line) { $meta += "`n" + $(if ($line.Length -gt 100) { $line.Substring(0, 99) + $bunnyEllipsis } else { $line }) }
    if ($planned) {
      $bar.IsIndeterminate = $false; $bar.Maximum = [double]$plan.total; $bar.Value = [double]$plan.completed
      $bar.Visibility = if ($live) { 'Visible' } else { 'Collapsed' }
    } elseif ($live) {
      # No plan from the agent means no denominator: an animated bar, never a percentage.
      $bar.IsIndeterminate = $true; $bar.Visibility = 'Visible'
    } else { $bar.IsIndeterminate = $false; $bar.Visibility = 'Collapsed' }
    if ($task.state -eq 'waiting_for_approval') { $meta += "`n" + $task.decision.reason }
    # The bar borrows its 12 px from the output box so the footer row never moves.
    $bunnyControls.Output.Height = if ($bar.Visibility -eq 'Visible') { 74 } else { 86 }
    Set-BunnyDetail $task.title $meta
    $bunnyControls.TaskDetail.ToolTip = 'Folder: ' + $task.cwd + $(if ($latest -and $latest.detail) { "`n" + $latest.label + ': ' + $latest.detail } else { '' }) + "`n" + $task.decision.reason
    $bunnyControls.Output.Text = if ($task.error) { $task.error } else { $task.output }
  } elseif (-not @($bunnySnapshot.tasks).Count) {
    $bar.IsIndeterminate = $false; $bar.Visibility = 'Collapsed'
    Set-BunnyDetail '' 'No tasks yet. Describe one below and Bunny-A will recommend an agent for your review.'
    $bunnyControls.Output.Text = ''
  } else { $bar.IsIndeterminate = $false; $bar.Visibility = 'Collapsed' }
}
function Update-Bunny {
  try {
    $script:bunnySnapshot = Invoke-Bunny
    $active = @($bunnySnapshot.tasks | Where-Object state -notin @('completed', 'failed', 'stopped'))
    $bunnyControls.ActiveBadge.Visibility = if ($active.Count) { 'Visible' } else { 'Collapsed' }
    $bunnyControls.ActiveText.Text = [string]$active.Count + ' active'
    $bunnyControls.Presence.Text = 'Workstation online ' + $bunnyDot + ' ' + $active.Count + ' active ' + $(if ($active.Count -eq 1) { 'task' } else { 'tasks' })
    Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyPositive'
    Draw-BunnyProviders
    $bunnyControls.Graphs.Visibility = if ($bunnySystemMode) { 'Visible' } else { 'Collapsed' }
    $bunnyControls.Tasks.Visibility = if ($bunnySystemMode) { 'Collapsed' } else { 'Visible' }
    $bunnyControls.Prompt.Visibility = if ($bunnySystemMode) { 'Collapsed' } else { 'Visible' }
    $bunnyControls.PromptLabel.Visibility = if ($bunnySystemMode) { 'Collapsed' } else { 'Visible' }
    $bunnyControls.TaskActions.Visibility = if ($bunnySystemMode) { 'Collapsed' } else { 'Visible' }
    Update-BunnyRouteState
    if ($bunnySystemMode) { $bunnyControls.ApproveButton.IsEnabled = $false; $bunnyControls.StopButton.IsEnabled = $false; $bunnyControls.TerminalButton.IsEnabled = $false; $bunnyControls.TaskProgress.Visibility = 'Collapsed' }
    $bunnyControls.Graphs.Children.Clear()
    if ($bunnySystemMode) {
      $sample = @($bunnySnapshot.samples) | Select-Object -Last 1
      if ($sample) {
        $ram = [Math]::Round($sample.memory.usedBytes / 1GB, 1); $total = [Math]::Round($sample.memory.totalBytes / 1GB, 1)
        $gpu = @($sample.gpus | ForEach-Object { $_.name + ' ' + $bunnyDot + ' ' + $(if ($null -eq $_.utilization) { 'Utilization unavailable' } else { $_.utilization.ToString() + '%' }) + ' ' + $bunnyDot + ' ' + $(if ($null -eq $_.temperatureC) { 'Temperature unavailable' } else { $_.temperatureC.ToString() + [string][char]0x00B0 + 'C' }) }) -join "`n"
        Set-BunnyDetail 'This workstation' ('CPU ' + $sample.cpu.utilization + '% ' + $bunnyDot + ' ' + $sample.cpu.clockMhz + " MHz`nRAM " + $ram + ' / ' + $total + " GB`n" + $gpu + "`nCPU and unsupported temperatures unavailable")
        $history = @($bunnySnapshot.samples | Select-Object -Last 40)
        Draw-BunnyGraph 'CPU' @($history | ForEach-Object { $_.cpu.utilization }) '%'
        Draw-BunnyGraph 'Memory' @($history | ForEach-Object { 100 * $_.memory.usedBytes / $_.memory.totalBytes }) '%'
        foreach ($device in $sample.gpus) { $deviceName = $device.name; Draw-BunnyGraph ($deviceName) @($history | ForEach-Object { @($_.gpus | Where-Object name -eq $deviceName)[0].utilization }) '%' }
        $bunnyControls.Output.Text = 'Graphs show the last 120 seconds of real Host samples. Gaps mean a sensor is unavailable.'
      }
    } else {
      $signature = (@($bunnySnapshot.tasks | Select-Object -First 20 | ForEach-Object { $_.id + ':' + $_.state + ':' + $_.finishedAt }) -join '|') + '#' + $bunnySelectedId
      $running = @($bunnySnapshot.tasks | Where-Object { $_.state -in @('running', 'launching', 'verifying') }).Count
      if ($signature -ne $script:bunnyTaskSignature -or $running) {
        $script:bunnyTaskSignature = $signature
        $scroll = Find-BunnyScrollViewer $bunnyControls.Tasks
        $offset = if ($scroll) { $scroll.VerticalOffset } else { 0 }
        $script:bunnyUpdating = $true
        $bunnyControls.Tasks.Items.Clear()
        foreach ($task in @($bunnySnapshot.tasks | Select-Object -First 20)) {
          $item = [Windows.Controls.ListBoxItem]::new(); $item.Content = New-BunnyTaskRow $task; $item.Tag = $task.id
          [void]$bunnyControls.Tasks.Items.Add($item)
          if ($task.id -eq $script:bunnySelectedId) { $item.IsSelected = $true }
        }
        if (-not $script:bunnySelectedId -and $bunnyControls.Tasks.Items.Count) { $bunnyControls.Tasks.SelectedIndex = 0 }
        $script:bunnyUpdating = $false
        if ($offset -gt 0) { $bunnyControls.Tasks.UpdateLayout(); $scroll = Find-BunnyScrollViewer $bunnyControls.Tasks; if ($scroll) { $scroll.ScrollToVerticalOffset($offset) } }
      }
      Show-BunnyTask
    }
    Update-BunnyChrome
  } catch {
    $script:bunnyLastError = $_.Exception.Message
    $bunnyControls.Presence.Text = 'Host unreachable ' + $bunnyDot + ' workstation may be offline or sleeping'
    Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyNegative'
    $bunnyControls.ActiveBadge.Visibility = 'Collapsed'
    $bunnyControls.ApproveButton.IsEnabled = $false; $bunnyControls.StopButton.IsEnabled = $false
  }
}

# ---------- theme ----------
function Set-BunnyTheme([bool]$Light) {
  $script:bunnyLight = $Light
  $palette = if ($Light) {
    @{ BunnyText = '#1D1D1F'; BunnyMuted = '#5C5C61'; BunnyField = '#1A767680'; BunnyHover = '#0F000000'; BunnyPopup = '#FFFFFF'; BunnyAccent = '#0071E3'; BunnyAccentSoft = '#1A0071E3'; BunnyOnAccent = '#FFFFFF'
       BunnyPositive = '#1F7A3A'; BunnyPositiveSoft = '#1A1F7A3A'; BunnyNegative = '#D70015'; BunnyNegativeSoft = '#1AD70015'; BunnyWarning = '#A35200'; BunnyWarningSoft = '#1AA35200'; BunnySep = '#1F3C3C43'; BunnySegment = '#FFFFFF' }
  } else {
    @{ BunnyText = '#F5F5F7'; BunnyMuted = '#A1A1A6'; BunnyField = '#1FFFFFFF'; BunnyHover = '#14FFFFFF'; BunnyPopup = '#2C2C2E'; BunnyAccent = '#0A84FF'; BunnyAccentSoft = '#2E0A84FF'; BunnyOnAccent = '#FFFFFF'
       BunnyPositive = '#30D158'; BunnyPositiveSoft = '#2430D158'; BunnyNegative = '#FF453A'; BunnyNegativeSoft = '#24FF453A'; BunnyWarning = '#FF9F0A'; BunnyWarningSoft = '#24FF9F0A'; BunnySep = '#1FFFFFFF'; BunnySegment = '#636366' }
  }
  foreach ($key in $palette.Keys) { $bunnyWindow.Resources[$key] = New-BunnyBrush $palette[$key] }
  $bunnyControls.Glass.Background = New-BunnyBrush $(if ($Light) { '#F7F2F2F7' } else { '#F51C1C1E' })
  $tileColors = if ($Light) { @('#3A3A3C', '#1C1C1E') } else { @('#F5F5F7', '#D1D1D6') }
  $tileGradient = [Windows.Media.LinearGradientBrush]::new(); $tileGradient.StartPoint = '0,0'; $tileGradient.EndPoint = '0,1'
  [void]$tileGradient.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString($tileColors[0]), 0))
  [void]$tileGradient.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString($tileColors[1]), 1))
  $bunnyControls.BrandTile.Background = $tileGradient
  $bunnyControls.BrandMark.Fill = New-BunnyBrush $(if ($Light) { '#FFFFFF' } else { '#1C1C1E' })
  Set-BunnyButton $bunnyControls.ThemeButton '' $(if ($Light) { 'moon' } else { 'sun' }) 17
  if ($bunnySnapshot) { Draw-BunnyProviders }
}

# Visual implementation uses the same Host access, icon, process-independent window,
# and screenshot helpers above. Host execution and session ownership are unchanged.
. (Join-Path $PSScriptRoot 'Bunny-Island.Visual.ps1')
return

# ---------- initial content ----------
Set-BunnyButton $bunnyControls.CloseButton '' 'x' 17
Set-BunnyButton $bunnyControls.ExpandButton '' 'chevron-down' 17
Set-BunnyButton $bunnyControls.PhoneButton '' 'smartphone' 17
Set-BunnyButton $bunnyControls.ExtrasButton '' 'ellipsis' 17
Set-BunnyButton $bunnyControls.SystemButton '' 'activity' 17
Set-BunnyButton $bunnyControls.RouteButton 'Route task' 'arrow-right'
Set-BunnyButton $bunnyControls.ApproveButton 'Approve' 'play' 13
Set-BunnyButton $bunnyControls.StopButton 'Stop' 'square' 13
Set-BunnyButton $bunnyControls.OpenButton 'Open workspace' 'external-link'
Set-BunnyTheme $false
$bunnyControls.RouteButton.IsEnabled = $false

# ---------- events ----------
$bunnyControls.Tasks.Add_SelectionChanged({ if ($bunnyControls.Tasks.SelectedItem) { $script:bunnySelectedId = $bunnyControls.Tasks.SelectedItem.Tag; if (-not $bunnyUpdating) { $script:bunnyPhoneMode = $false; Show-BunnyTask; Update-BunnyChrome } } })
$bunnyControls.Prompt.Add_TextChanged({ Update-BunnyRouteState })
$bunnyControls.Prompt.Add_PreviewKeyDown({
  if ($_.Key -eq 'Return' -and ([Windows.Input.Keyboard]::Modifiers -band [Windows.Input.ModifierKeys]::Control)) {
    $_.Handled = $true
    if ($bunnyControls.RouteButton.IsEnabled) { Invoke-BunnyClick $bunnyControls.RouteButton }
  }
})
$bunnyControls.CloseButton.Add_Click({ $bunnyWindow.Close() })
$bunnyControls.ExpandButton.Add_Click({ if ($bunnyExpanded) { Close-BunnyDetails } else { Expand-Bunny } })
$bunnyWindow.Add_MouseEnter({ Expand-Bunny })
$bunnyWindow.Add_MouseWheel({ Expand-Bunny })
$bunnyControls.SystemButton.Add_Click({ $script:bunnyPhoneMode = $false; $script:bunnySystemMode = -not $bunnySystemMode; Expand-Bunny; Update-Bunny })
$bunnyControls.PhoneButton.Add_Click({
  Expand-Bunny
  $script:bunnyPhoneMode = $true; $script:bunnySystemMode = $false
  Update-BunnyChrome
  try {
    if (-not $bunnySnapshot.remoteConfigured) { Set-BunnyDetail 'Phone' 'The secure phone connection is not configured on this workstation.'; $bunnyControls.Notice.Text = 'Secure phone connection is not configured.'; return }
    $result = Invoke-Bunny 'pairing.create' @{}
    $address = if ($result.snapshot.remoteUrl) { $result.snapshot.remoteUrl + '/?companion=1' } else { $null }
    $bunnyControls.Notice.Text = 'Use this single-use code within 10 minutes.'
    Set-BunnyDetail 'Your phone. The same workspace.' $(if ($address) { 'Open the secure address below on your phone, then enter this one-time code.' } else { 'The secure phone address is not available right now. Restart the connection, then create a code again.' })
    $bunnyControls.Output.Text = $(if ($address) { $address + "`n" } else { '' }) + 'Pairing code: ' + $result.pairCode
  } catch { $bunnyControls.Notice.Text = $_.Exception.Message }
})
$bunnyControls.ExtrasButton.Add_Click({
  Expand-Bunny; $script:bunnyPhoneMode = $true; $script:bunnySystemMode = $false
  Update-BunnyChrome
  $extras = @($bunnySnapshot.providers | Where-Object { $_.installed -and $_.extension })
  Set-BunnyDetail 'Other integrations' 'Optional agents detected on this workstation.'
  $bunnyControls.Output.Text = if ($extras.Count) { @($extras | ForEach-Object { $_.name + ' ' + $bunnyDot + ' ' + $_.availability + "`n" + $_.detail }) -join "`n`n" } else { 'No optional agent integrations detected.' }
  $bunnyControls.Notice.Text = 'Only integrations discovered on this workstation are listed.'
})
$bunnyControls.RouteButton.Add_Click({
  try {
    $mode = @('fast', 'balanced', 'deep')[$bunnyControls.Mode.SelectedIndex]
    $result = Invoke-Bunny 'submit' @{ prompt = $bunnyControls.Prompt.Text; mode = $mode; override = 'auto' }
    $script:bunnyPhoneMode = $false; $script:bunnySelectedId = $result.task.id; $bunnyControls.Prompt.Clear(); $script:bunnySystemMode = $false; $bunnyControls.Notice.Text = ''; Update-Bunny
  } catch { $bunnyControls.Notice.Text = Get-BunnyError $_ }
})
$bunnyControls.ApproveButton.Add_Click({ try { [void](Invoke-Bunny 'approve' @{ id = $bunnySelectedId }); Update-Bunny } catch { $bunnyControls.Notice.Text = Get-BunnyError $_ } })
$bunnyControls.StopButton.Add_Click({ try { [void](Invoke-Bunny 'stop' @{ id = $bunnySelectedId }); Update-Bunny } catch { $bunnyControls.Notice.Text = Get-BunnyError $_ } })
$bunnyControls.TerminalButton.Add_Click({
  # The Host decides per provider; when it cannot attach it says so, and nothing else is opened in its place.
  try { [void](Invoke-Bunny 'terminal' @{ id = $bunnySelectedId }); $bunnyControls.Notice.Text = 'Terminal attached.' } catch { $bunnyControls.Notice.Text = Get-BunnyError $_ }
})
$bunnyControls.OpenButton.Add_Click({Open-BunnyDashboard})
$bunnyControls.ThemeButton.Add_Click({ Set-BunnyTheme (-not $bunnyLight) })
if ($LightView) { Set-BunnyTheme $true }

# ---------- test support ----------
function Invoke-BunnyClick($Control) {
  # Raises Click synchronously so the real handler runs now (UI Automation Invoke() would queue it behind the caller).
  if (-not $Control.IsEnabled) { throw ('Control is disabled: ' + $Control.Name) }
  $Control.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Primitives.ButtonBase]::ClickEvent, $Control))
}
function Save-BunnyScreenshot([string]$Name) {
  $directory = if ($ScreenshotDirectory) { $ScreenshotDirectory } else { Join-Path $Root 'screenshots' }
  [void](New-Item -ItemType Directory -Path $directory -Force)
  $bunnyWindow.UpdateLayout()
  $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new([int]$bunnyWindow.ActualWidth, [int]$bunnyWindow.ActualHeight, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
  $bitmap.Render($bunnyWindow)
  $encoder = [Windows.Media.Imaging.PngBitmapEncoder]::new(); $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $path = Join-Path $directory ($Name + '.png')
  $stream = [IO.File]::Create($path)
  try { $encoder.Save($stream) } finally { $stream.Dispose() }
  return $path
}

# ---------- run ----------
$bunnyTimer = [Windows.Threading.DispatcherTimer]::new(); $bunnyTimer.Interval = [TimeSpan]::FromSeconds(2); $bunnyTimer.Add_Tick({ Update-Bunny }); $bunnyTimer.Start()
$bunnyWindow.Add_Closed({ $bunnyTimer.Stop() })
$bunnyWindow.Add_Loaded({ Update-Bunny })
$bunnySmokeFailed = $false
if ($SmokeTest) {
  $smokeTimer = [Windows.Threading.DispatcherTimer]::new(); $smokeTimer.Interval = [TimeSpan]::FromSeconds(3)
  $smokeTimer.Add_Tick({
    $smokeTimer.Stop()
    try {
      if ($TestHook) { . $TestHook }
      else {
        if ($CollapsedView) { Close-BunnyDetails } else { Expand-Bunny }
        Update-Bunny
        $screenshotName = if ($CollapsedView) { 'bunny-native-collapsed' } elseif ($LightView) { 'bunny-native-light' } elseif ($SystemView) { 'bunny-native-system' } else { 'bunny-native-island' }
        [void](Save-BunnyScreenshot $screenshotName)
      }
      if ($bunnyLastError) { [Console]::Error.WriteLine('Island update error: ' + $bunnyLastError); $script:bunnySmokeFailed = $true }
    } catch { [Console]::Error.WriteLine('Island smoke test failed: ' + $_.Exception.Message + ' @ ' + $_.InvocationInfo.PositionMessage); $script:bunnySmokeFailed = $true }
    finally { $bunnyWindow.Close() }
  })
  $smokeTimer.Start()
}
[void]$bunnyWindow.ShowDialog()
if ($bunnySmokeFailed) { exit 1 }
