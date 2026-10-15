# Dot-sourced UI layer. Invoke-Bunny continues to use the existing authenticated Host contract.
function Invoke-BunnyClick($Control) { if(-not$Control.IsEnabled){throw ('Control is disabled: '+$Control.Name)};$Control.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Primitives.ButtonBase]::ClickEvent,$Control)) }
function Save-BunnyScreenshot([string]$Name) {
 $directory=if($ScreenshotDirectory){$ScreenshotDirectory}else{Join-Path $Root 'screenshots'};[void](New-Item -ItemType Directory -Path $directory -Force);Resize-Bunny;$bunnyWindow.UpdateLayout()
 # A WPF resize reaches the HWND on the next dispatcher pass, including in test hooks.
 # The HWND can lag the requested size by a few passes (a strip can make the notch taller); pump until the actual height matches.
 for($attempt=0;$attempt-lt10;$attempt++){$frame=[Windows.Threading.DispatcherFrame]::new();$settle=[Windows.Threading.DispatcherTimer]::new();$settle.Interval=[TimeSpan]::FromMilliseconds(40);$settle.Add_Tick({$settle.Stop();$frame.Continue=$false});$settle.Start();[Windows.Threading.Dispatcher]::PushFrame($frame);$bunnyWindow.UpdateLayout();if([Math]::Abs($bunnyWindow.ActualHeight-$bunnyWindow.Height)-lt1){break}}
 $bitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new([int]$bunnyWindow.ActualWidth,[int]$bunnyWindow.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32);$bitmap.Render($bunnyWindow);$encoder=[Windows.Media.Imaging.PngBitmapEncoder]::new();$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap));$path=Join-Path $directory ($Name+'.png');$stream=[IO.File]::Create($path);try{$encoder.Save($stream)}finally{$stream.Dispose()};return $path
}
$bunnyPreferencePath = if($PreferencePath) {$PreferencePath} else {throw 'Installed Island requires an explicit preference path; the retired repository path is refused.'}
$bunnyPreferences = @{ size='compact'; position='center'; idle='providers'; glass='medium'; motion='full'; collapse=10; theme='dark'; primary=@('codex','claude','ollama'); edge='top'; edgeOffset=0.5; blur='off'; monitor=$null }
. (Join-Path $PSScriptRoot 'Bunny-Island.Placement.ps1')
. (Join-Path $PSScriptRoot 'Bunny-Island.Characters.ps1')
try { if (Test-Path -LiteralPath $bunnyPreferencePath) { $saved=Get-Content -LiteralPath $bunnyPreferencePath -Raw | ConvertFrom-Json; foreach ($property in $saved.PSObject.Properties) { if ($bunnyPreferences.ContainsKey($property.Name)) { $bunnyPreferences[$property.Name]=$property.Value } } } } catch { }
$bunnyView='idle'; $bunnyExpanded=$false; $bunnyTaskExpanded=$false; $bunnyPending=$null; $bunnyFinishedAt=$null; $bunnySeenTaskState=''; $bunnyHeatDismissed=$null; $bunnyHot=$null; $bunnyOnline=$false; $bunnySettingsUpdating=$false
$bunnyAnimate = -not $SmokeTest -and [Windows.SystemParameters]::ClientAreaAnimation -and -not [Windows.SystemParameters]::HighContrast
[xml]$bunnyVisualXaml = @'
<StackPanel x:Name="NotchRoot" Orientation="Horizontal" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
 <StackPanel.Resources>
  <Style TargetType="ComboBox">
   <Setter Property="Foreground" Value="{DynamicResource BunnyText}"/>
   <Setter Property="Background" Value="{DynamicResource BunnyField}"/>
   <Setter Property="BorderBrush" Value="{DynamicResource BunnySep}"/>
   <Setter Property="MinHeight" Value="44"/>
   <Setter Property="Padding" Value="12,8"/>
   <Setter Property="ScrollViewer.HorizontalScrollBarVisibility" Value="Disabled"/>
   <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ComboBox">
    <Grid>
     <ToggleButton Focusable="False" IsChecked="{Binding IsDropDownOpen, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}">
      <ToggleButton.Template><ControlTemplate TargetType="ToggleButton"><Border x:Name="Field" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1" CornerRadius="10"><Path Data="M0,0 L4,4 L8,0" Stroke="{DynamicResource BunnyMuted}" StrokeThickness="1.3" HorizontalAlignment="Right" VerticalAlignment="Center" Margin="0,0,13,0"/></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Field" Property="Background" Value="{DynamicResource BunnyHover}"/></Trigger></ControlTemplate.Triggers></ControlTemplate></ToggleButton.Template>
     </ToggleButton>
     <ContentPresenter IsHitTestVisible="False" Content="{TemplateBinding SelectionBoxItem}" ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}" Margin="12,8,32,8" VerticalAlignment="Center"/>
     <Border x:Name="Focus" IsHitTestVisible="False" BorderBrush="{DynamicResource BunnyAccent}" BorderThickness="2" CornerRadius="10" Visibility="Collapsed"/>
     <Popup x:Name="PART_Popup" AllowsTransparency="True" Placement="Bottom" IsOpen="{TemplateBinding IsDropDownOpen}" Focusable="False">
      <Border Background="{DynamicResource BunnyPopup}" BorderBrush="{DynamicResource BunnySep}" BorderThickness="1" CornerRadius="12" Padding="4" MinWidth="{Binding ActualWidth, RelativeSource={RelativeSource TemplatedParent}}"><ScrollViewer MaxHeight="240" CanContentScroll="True" HorizontalScrollBarVisibility="Disabled" VerticalScrollBarVisibility="Auto"><ItemsPresenter KeyboardNavigation.DirectionalNavigation="Contained"/></ScrollViewer></Border>
     </Popup>
    </Grid>
    <ControlTemplate.Triggers><Trigger Property="IsKeyboardFocusWithin" Value="True"><Setter TargetName="Focus" Property="Visibility" Value="Visible"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.45"/></Trigger></ControlTemplate.Triggers>
   </ControlTemplate></Setter.Value></Setter>
  </Style>
  <Style TargetType="ComboBoxItem"><Setter Property="Foreground" Value="{DynamicResource BunnyText}"/><Setter Property="MinHeight" Value="44"/><Setter Property="Padding" Value="12,8"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ComboBoxItem"><Border x:Name="Item" CornerRadius="8" Padding="{TemplateBinding Padding}" Background="Transparent"><ContentPresenter/></Border><ControlTemplate.Triggers><Trigger Property="IsHighlighted" Value="True"><Setter TargetName="Item" Property="Background" Value="{DynamicResource BunnyHover}"/></Trigger><Trigger Property="IsSelected" Value="True"><Setter TargetName="Item" Property="Background" Value="{DynamicResource BunnyAccentSoft}"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
  <Style TargetType="CheckBox"><Setter Property="Foreground" Value="{DynamicResource BunnyText}"/><Setter Property="MinHeight" Value="44"/><Setter Property="Cursor" Value="Hand"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="CheckBox"><DockPanel><Border x:Name="Box" Width="18" Height="18" CornerRadius="5" BorderThickness="1" BorderBrush="{DynamicResource BunnyMuted}" Background="{DynamicResource BunnyField}" Margin="0,0,8,0" VerticalAlignment="Center"><Path x:Name="Tick" Data="M0,4 L3,7 L9,0" Stroke="{DynamicResource BunnyAccent}" StrokeThickness="1.7" Margin="3" Visibility="Collapsed"/></Border><ContentPresenter VerticalAlignment="Center"/></DockPanel><ControlTemplate.Triggers><Trigger Property="IsChecked" Value="True"><Setter TargetName="Tick" Property="Visibility" Value="Visible"/><Setter TargetName="Box" Property="BorderBrush" Value="{DynamicResource BunnyAccent}"/></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Box" Property="BorderThickness" Value="2"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.45"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 </StackPanel.Resources>
 <Border x:Name="StripCapsule" Visibility="Collapsed" Height="58" Margin="0,14,-12,10" VerticalAlignment="Top" HorizontalAlignment="Left" CornerRadius="29" BorderThickness="1" BorderBrush="#24FFFFFF" Padding="6,0" Background="#FF0B0D14">
  <StackPanel x:Name="AgentStrip" Orientation="Horizontal" Visibility="Collapsed" HorizontalAlignment="Center" VerticalAlignment="Center" AutomationProperties.Name="Agent indicators"/>
 </Border>
 <Border x:Name="Glass" CornerRadius="28" BorderThickness="1" Padding="6,0" Margin="10,14,10,10">
  <Border.Effect><DropShadowEffect BlurRadius="24" ShadowDepth="8" Opacity="0.45" Color="#FF000000"/></Border.Effect>
  <StackPanel x:Name="GlassStack">
   <DockPanel x:Name="Header" Height="56" LastChildFill="False">
    <DockPanel.Resources>
     <SolidColorBrush x:Key="BunnyText" Color="#FFEEF2FA"/><SolidColorBrush x:Key="BunnyMuted" Color="#FF9AA3B8"/><SolidColorBrush x:Key="BunnyAccent" Color="#FF8EB9FF"/>
     <SolidColorBrush x:Key="BunnyField" Color="#14FFFFFF"/><SolidColorBrush x:Key="BunnyHover" Color="#26FFFFFF"/><SolidColorBrush x:Key="BunnySep" Color="#24FFFFFF"/>
     <SolidColorBrush x:Key="BunnyAccentSoft" Color="#338EB9FF"/><SolidColorBrush x:Key="BunnyOnAccent" Color="#FF14213A"/><SolidColorBrush x:Key="BunnyPositive" Color="#FF85CFA5"/>
     <SolidColorBrush x:Key="BunnyWarning" Color="#FFE6BF78"/><SolidColorBrush x:Key="BunnyNegative" Color="#FFF5A09D"/>
    </DockPanel.Resources>
    <Button x:Name="ExtrasButton" DockPanel.Dock="Right" Width="44" Height="44" Style="{DynamicResource IconButton}" ToolTip="Quick controls" AutomationProperties.Name="Quick controls"/>
    <Button x:Name="SearchButton" DockPanel.Dock="Right" Width="44" Height="44" Style="{DynamicResource IconButton}" ToolTip="Open workspace" AutomationProperties.Name="Open workspace"/>
    <Button x:Name="BunnyButton" DockPanel.Dock="Left" Width="60" Height="56" Padding="0" Background="Transparent" BorderThickness="0" VerticalContentAlignment="Center" HorizontalContentAlignment="Center" ToolTip="Ask Bunny" AutomationProperties.Name="Ask Bunny"><Border x:Name="BrandTile" Width="56" Height="56" CornerRadius="0" Background="Transparent" BorderThickness="0"><Grid><Image x:Name="BunnyArt" Width="56" Height="56" Stretch="Uniform" VerticalAlignment="Center" HorizontalAlignment="Center" RenderOptions.BitmapScalingMode="HighQuality" AutomationProperties.Name="Bunny companion"/><Border x:Name="CompanionRing" CornerRadius="18" BorderThickness="1.5" Opacity="0" IsHitTestVisible="False" RenderTransformOrigin="0.5,0.5"><Border.RenderTransform><ScaleTransform x:Name="RingScale"/></Border.RenderTransform></Border><Border x:Name="CompanionTint" CornerRadius="18" Background="#8C06080D" Opacity="0" IsHitTestVisible="False"/><Border x:Name="CompanionBadge" Visibility="Collapsed" Width="12" Height="12" CornerRadius="6" Background="#FF2C2C2E" HorizontalAlignment="Right" VerticalAlignment="Bottom" Margin="0,0,-3,-3" IsHitTestVisible="False"><TextBlock x:Name="CompanionBadgeText" FontSize="9" FontWeight="Bold" HorizontalAlignment="Center" VerticalAlignment="Center" Foreground="#FFFFFFFF"/></Border><Path x:Name="BrandMark" Visibility="Collapsed" Data="M10 17C7 13 7 5 10 5S14 11 14 15H18C18 11 19 5 22 5S25 13 22 17C25 19 25 24 22 26C19 29 13 29 10 26C7 24 7 19 10 17Z M10.8 21 A1.2 1.2 0 1 0 13.2 21 A1.2 1.2 0 1 0 10.8 21 M18.8 21 A1.2 1.2 0 1 0 21.2 21 A1.2 1.2 0 1 0 18.8 21" Fill="{DynamicResource BunnyText}" Width="17" Height="22" Stretch="Uniform" HorizontalAlignment="Center" VerticalAlignment="Center"/></Grid></Border></Button>
    <Button x:Name="VoiceButton" DockPanel.Dock="Left" Width="44" Height="44" Style="{DynamicResource IconButton}" ToolTip="Voice: hold to talk" AutomationProperties.Name="Voice input"/>
    <StackPanel x:Name="NotchBars" DockPanel.Dock="Left" Orientation="Horizontal" VerticalAlignment="Center" Height="22" Margin="0,0,8,0" AutomationProperties.Name="Input level">
     <Border x:Name="Bar1" Width="3" Height="4" CornerRadius="1.5" Margin="1.5,0" VerticalAlignment="Center" Background="{DynamicResource BunnyAccent}"/><Border x:Name="Bar2" Width="3" Height="4" CornerRadius="1.5" Margin="1.5,0" VerticalAlignment="Center" Background="{DynamicResource BunnyAccent}"/><Border x:Name="Bar3" Width="3" Height="4" CornerRadius="1.5" Margin="1.5,0" VerticalAlignment="Center" Background="{DynamicResource BunnyAccent}"/><Border x:Name="Bar4" Width="3" Height="4" CornerRadius="1.5" Margin="1.5,0" VerticalAlignment="Center" Background="{DynamicResource BunnyAccent}"/><Border x:Name="Bar5" Width="3" Height="4" CornerRadius="1.5" Margin="1.5,0" VerticalAlignment="Center" Background="{DynamicResource BunnyAccent}"/>
    </StackPanel>
    <TextBlock x:Name="NotchStatus" DockPanel.Dock="Left" Text="Ready" MaxWidth="128" FontSize="13" VerticalAlignment="Center" TextTrimming="CharacterEllipsis" Foreground="{DynamicResource BunnyText}" AutomationProperties.Name="Voice status"/>
    <Button x:Name="SystemButton" Visibility="Collapsed" DockPanel.Dock="Right" Width="56" Padding="0" ToolTip="System telemetry" AutomationProperties.Name="System telemetry"><TextBlock x:Name="Temperature" Text="" FontSize="13" Foreground="{DynamicResource BunnyMuted}"/></Button>
    <Border x:Name="HeaderSep" Visibility="Collapsed" DockPanel.Dock="Left" Width="1" Height="20" Background="{DynamicResource BunnySep}" Margin="4,0,10,0"/>
    <StackPanel x:Name="Providers" Visibility="Collapsed" Orientation="Horizontal" VerticalAlignment="Center"/>
   </DockPanel>
   <Border x:Name="PanelSurface" Visibility="Collapsed" Background="{DynamicResource BunnyPanel}" CornerRadius="22" Margin="0,6,0,6">
    <StackPanel x:Name="PanelStack">
   <Button x:Name="CompactTask" Visibility="Collapsed" Padding="8,8" HorizontalContentAlignment="Stretch" Margin="0,8,0,0" AutomationProperties.Name="Expand active task"><DockPanel><TextBlock x:Name="CompactTime" DockPanel.Dock="Right" Foreground="{DynamicResource BunnyMuted}" VerticalAlignment="Center"/><StackPanel><TextBlock x:Name="CompactTitle" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock x:Name="CompactActivity" FontSize="12" Foreground="{DynamicResource BunnyAccent}" TextTrimming="CharacterEllipsis"/></StackPanel></DockPanel></Button>
   <TextBlock x:Name="CompactVoice" Visibility="Collapsed" Margin="8,8,8,0" Foreground="{DynamicResource BunnyAccent}" FontSize="12" TextWrapping="Wrap" AutomationProperties.Name="Voice status"/>
   <TextBlock x:Name="CompactHealth" Visibility="Collapsed" Margin="8,8,8,0" Foreground="{DynamicResource BunnyWarning}" FontSize="12" TextWrapping="Wrap"/>
   <Button x:Name="CompactMission" Visibility="Collapsed" Padding="8,8" HorizontalContentAlignment="Stretch" Margin="0,8,0,0" AutomationProperties.Name="Open Mission Control"><StackPanel><TextBlock x:Name="MissionTitle" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock x:Name="MissionWorkers" FontSize="12" Foreground="{DynamicResource BunnyAccent}" TextWrapping="Wrap"/></StackPanel></Button>
   <Border x:Name="CompactAgent" Visibility="Collapsed" Background="{DynamicResource BunnyField}" CornerRadius="16" Padding="12" Margin="0,8,0,0">
    <StackPanel>
     <Button x:Name="AgentOpen" Style="{DynamicResource BunnyButtonBase}" HorizontalContentAlignment="Left" Padding="0" AutomationProperties.Name="Open current Agent"><StackPanel><TextBlock x:Name="AgentName" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock x:Name="AgentState" FontSize="12" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap"/></StackPanel></Button>
     <TextBlock x:Name="AgentBoundary" FontSize="12" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" Margin="0,4,0,4"/>
     <WrapPanel><Button x:Name="AgentPause" Content="Pause" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Pause current Agent"/><Button x:Name="AgentResume" Content="Resume" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Resume current Agent"/><Button x:Name="AgentStop" Content="Stop" Style="{DynamicResource DangerButton}" AutomationProperties.Name="Stop current Agent"/><Button x:Name="AgentReview" Content="Review access" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Review current Agent authorization"/></WrapPanel>
    </StackPanel>
   </Border>
   <ScrollViewer x:Name="DetailsScroll" Visibility="Collapsed" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled"><StackPanel x:Name="Details" Visibility="Collapsed" Margin="8,12,8,4">
    <StackPanel Orientation="Horizontal" Margin="0,0,0,16"><Ellipse x:Name="PresenceDot" Width="5" Height="5" Margin="0,0,8,0" VerticalAlignment="Center" Fill="{DynamicResource BunnyPositive}"/><TextBlock x:Name="Presence" Foreground="{DynamicResource BunnyMuted}" FontSize="12"/></StackPanel>
    <StackPanel x:Name="QuickPanel" Visibility="Collapsed" Margin="0,0,0,4">
     <TextBlock Text="Bunny" FontSize="18" FontWeight="SemiBold" Margin="0,0,0,12"/>
     <WrapPanel Margin="0,0,0,14">
      <Button x:Name="QuickVoice" Content="Voice" Style="{DynamicResource SoftButton}" Margin="0,0,8,8" AutomationProperties.Name="Open voice controls"/>
      <Button x:Name="QuickWorkspace" Content="Open workspace" Style="{DynamicResource SoftButton}" Margin="0,0,8,8" AutomationProperties.Name="Open workspace"/>
      <Button x:Name="QuickApprovals" Content="No approvals waiting" Style="{DynamicResource BunnyButtonBase}" Margin="0,0,8,8" AutomationProperties.Name="Pending approvals"/>
      <Button x:Name="QuickMore" Content="More" Style="{DynamicResource BunnyButtonBase}" Margin="0,0,8,8" AutomationProperties.Name="More Island options"/>
     </WrapPanel>
     <TextBlock Text="PERSONAL AGENTS" FontSize="11" Foreground="{DynamicResource BunnyMuted}" Margin="0,0,0,8"/>
     <StackPanel x:Name="SlotRows"/>
     <TextBlock x:Name="QuickHost" FontSize="12" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" Margin="0,10,0,2"/>
     <TextBlock x:Name="QuickVoiceState" FontSize="12" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap"/>
    </StackPanel>
    <StackPanel x:Name="ComposerPanel" Visibility="Collapsed">
     <TextBlock x:Name="PromptLabel" Text="What do you want Bunny to do?" FontSize="21" FontWeight="SemiBold" Margin="0,0,0,16"/>
     <TextBox x:Name="Prompt" Tag="Describe a task. Bunny will find the right agent." Height="122" MaxLength="16000" AcceptsReturn="True" TextWrapping="Wrap" AutomationProperties.Name="Task description"/>
     <Border Background="{DynamicResource BunnyField}" CornerRadius="14" Padding="4" Margin="0,16,0,12" HorizontalAlignment="Left"><ListBox x:Name="Mode" SelectedIndex="1" Background="Transparent" BorderThickness="0" AutomationProperties.Name="Task depth"><ListBox.ItemsPanel><ItemsPanelTemplate><UniformGrid Rows="1"/></ItemsPanelTemplate></ListBox.ItemsPanel><ListBoxItem Style="{DynamicResource BunnySegmentItem}" Content="Fast"/><ListBoxItem Style="{DynamicResource BunnySegmentItem}" Content="Balanced"/><ListBoxItem Style="{DynamicResource BunnySegmentItem}" Content="Deep"/></ListBox></Border>
     <WrapPanel Margin="0,0,0,12"><StackPanel Margin="0,0,12,0"><TextBlock Text="Project" Foreground="{DynamicResource BunnyMuted}" FontSize="12"/><ComboBox x:Name="ProjectChoice" Width="168" MinHeight="44" AutomationProperties.Name="Task project"/></StackPanel><StackPanel Margin="0,0,12,0"><TextBlock Text="Route" Foreground="{DynamicResource BunnyMuted}" FontSize="12"/><ComboBox x:Name="RouteChoice" Width="106" MinHeight="44" AutomationProperties.Name="Task route"/></StackPanel><CheckBox x:Name="LocalOnly" Content="Local only" Foreground="{DynamicResource BunnyMuted}" MinHeight="44" VerticalContentAlignment="Center" AutomationProperties.Name="Local-only routing"/></WrapPanel>
     <DockPanel><Button x:Name="RouteButton" DockPanel.Dock="Right" Style="{DynamicResource PrimaryButton}"/><TextBlock Text="Ctrl + Enter to route  /  Esc to collapse" Foreground="{DynamicResource BunnyMuted}" FontSize="12" VerticalAlignment="Center"/></DockPanel>
    </StackPanel>
    <StackPanel x:Name="NativeVoicePanel" Visibility="Collapsed" Margin="0,4,0,12">
     <TextBlock x:Name="VoiceHeadline" Text="Voice is off" FontSize="21" FontWeight="SemiBold" TextWrapping="Wrap" AutomationProperties.Name="Voice state"/>
     <TextBlock x:Name="VoiceHint" Foreground="{DynamicResource BunnyMuted}" FontSize="12" TextWrapping="Wrap" Margin="0,6,0,10"/>
     <Border x:Name="VoiceMeterTrack" Height="4" CornerRadius="2" Background="{DynamicResource BunnyField}" Margin="0,0,0,12" HorizontalAlignment="Stretch" AutomationProperties.Name="Input level">
      <Border x:Name="VoiceMeter" Height="4" CornerRadius="2" Background="{DynamicResource BunnyAccent}" HorizontalAlignment="Left" Width="0"/>
     </Border>
     <TextBlock x:Name="VoiceDevice" Foreground="{DynamicResource BunnyWarning}" FontSize="12" TextWrapping="Wrap" Margin="0,0,0,8" AutomationProperties.Name="Microphone status"/>
     <TextBlock x:Name="VoicePartialLabel" Text="Draft, not sent yet" Foreground="{DynamicResource BunnyMuted}" FontSize="11" Visibility="Collapsed"/>
     <TextBlock x:Name="VoicePartial" Foreground="{DynamicResource BunnyMuted}" FontStyle="Italic" TextWrapping="Wrap" Visibility="Collapsed" AutomationProperties.Name="Draft transcript"/>
     <TextBlock x:Name="VoiceFinal" FontWeight="SemiBold" TextWrapping="Wrap" Margin="0,4,0,8" AutomationProperties.Name="Heard transcript"/>
     <TextBlock x:Name="VoiceRoute" Foreground="{DynamicResource BunnyMuted}" FontSize="12" TextWrapping="Wrap" Visibility="Collapsed" AutomationProperties.Name="Answer route"/>
     <TextBlock x:Name="VoiceAnswer" TextWrapping="Wrap" Margin="0,4,0,8" AutomationProperties.Name="Answer"/>
     <TextBlock x:Name="VoiceClarify" Foreground="{DynamicResource BunnyWarning}" TextWrapping="Wrap" Visibility="Collapsed" AutomationProperties.Name="Clarification"/>
     <Border x:Name="VoiceProposal" Visibility="Collapsed" Background="{DynamicResource BunnyWarningSoft}" CornerRadius="12" Padding="10" Margin="0,4,0,8">
      <StackPanel>
       <TextBlock x:Name="VoiceProposalText" TextWrapping="Wrap" AutomationProperties.Name="Pending voice proposal"/>
       <WrapPanel Margin="0,8,0,0"><Button x:Name="VoiceConfirm" Content="Confirm" Style="{DynamicResource PrimaryButton}" AutomationProperties.Name="Confirm proposal"/><Button x:Name="VoiceCancelProposal" Content="Cancel" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Cancel proposal"/></WrapPanel>
      </StackPanel>
     </Border>
     <WrapPanel Margin="0,4,0,8">
      <Button x:Name="VoiceMic" Content="Hold to talk" Style="{DynamicResource PrimaryButton}" AutomationProperties.Name="Hold to talk"/>
      <Button x:Name="VoiceInterrupt" Content="Stop speaking" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Stop speaking"/>
      <Button x:Name="VoiceMute" Content="Mute" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Mute microphone"/>
      <CheckBox x:Name="VoiceHandsFree" Content="Hands-free" AutomationProperties.Name="Hands-free listening, explicit opt-in"/>
      <Button x:Name="VoiceClose" Content="End voice" Style="{DynamicResource DangerButton}" AutomationProperties.Name="End voice session"/>
     </WrapPanel>
     <DockPanel>
      <Button x:Name="VoiceSend" DockPanel.Dock="Right" Content="Send" Style="{DynamicResource PrimaryButton}" AutomationProperties.Name="Send typed request"/>
      <TextBox x:Name="VoiceText" MaxLength="2000" Tag="Or type a request" AutomationProperties.Name="Typed voice request"/>
     </DockPanel>
    </StackPanel>
    <StackPanel x:Name="RoutingPanel" Visibility="Collapsed" Margin="0,16,0,16"><TextBlock Text="Choosing the best agent..." FontSize="21" FontWeight="SemiBold"/><TextBlock Text="Checking availability, task fit, and constraints." Foreground="{DynamicResource BunnyMuted}" Margin="0,12,0,16"/><ProgressBar Height="3" IsIndeterminate="True" Foreground="{DynamicResource BunnyAccent}" Background="{DynamicResource BunnyField}" BorderThickness="0"/><TextBlock Text="Your approval comes next." Foreground="{DynamicResource BunnyMuted}" FontSize="12" Margin="0,16,0,0"/></StackPanel>
    <StackPanel x:Name="ApprovalPanel" Visibility="Collapsed">
     <TextBlock x:Name="ApprovalTitle" FontSize="22" FontWeight="SemiBold"/><TextBlock x:Name="ApprovalReason" TextWrapping="Wrap" Foreground="{DynamicResource BunnyMuted}" Margin="0,12,0,8"/><TextBlock x:Name="ApprovalRequirements" TextWrapping="Wrap" FontSize="12" Foreground="{DynamicResource BunnyMuted}"/>
     <Border Background="{DynamicResource BunnyField}" CornerRadius="16" Padding="16" Margin="0,16,0,8"><StackPanel><TextBlock x:Name="ApprovalProvider" FontSize="16" FontWeight="SemiBold"/><TextBlock x:Name="ApprovalStatus" Foreground="{DynamicResource BunnyMuted}" FontSize="12" Margin="0,4,0,0"/></StackPanel></Border>
     <ComboBox x:Name="ChangeProvider" Visibility="Collapsed" MinHeight="44" Margin="0,8,0,8" AutomationProperties.Name="Change provider"/>
     <Expander Header="Routes considered" Foreground="{DynamicResource BunnyMuted}" Margin="0,8,0,8"><StackPanel><TextBlock x:Name="Scores" FontSize="12" TextWrapping="Wrap"/><TextBlock Text="Routing scores, not success probabilities." FontSize="11" Margin="0,8,0,8"/></StackPanel></Expander>
     <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,8,0,0"><Button x:Name="CancelButton" Content="Cancel" Margin="0,0,8,0"/><Button x:Name="ChangeButton" Content="Change" Style="{DynamicResource SoftButton}" Margin="0,0,8,0"/><Button x:Name="ApproveButton" Style="{DynamicResource PrimaryButton}"/></StackPanel>
    </StackPanel>
    <StackPanel x:Name="TasksPanel" Visibility="Collapsed"><DockPanel Margin="0,0,0,12"><TextBlock x:Name="ActiveText" DockPanel.Dock="Right" Foreground="{DynamicResource BunnyMuted}"/><TextBlock Text="Bunny" FontWeight="SemiBold" FontSize="18"/></DockPanel><ListBox x:Name="Tasks" MaxHeight="330" Background="Transparent" BorderThickness="0" ScrollViewer.HorizontalScrollBarVisibility="Disabled" AutomationProperties.Name="Active tasks"/><TextBlock Text="Scroll or use the arrow keys to focus a task." FontSize="12" Foreground="{DynamicResource BunnyMuted}" Margin="0,12,0,0"/></StackPanel>
    <StackPanel x:Name="TaskPanel" Visibility="Collapsed">
     <DockPanel><TextBlock x:Name="Elapsed" DockPanel.Dock="Right" Foreground="{DynamicResource BunnyMuted}"/><TextBlock x:Name="TaskProvider" Foreground="{DynamicResource BunnyMuted}"/></DockPanel>
     <TextBlock x:Name="TaskTitle" FontSize="21" FontWeight="SemiBold" TextWrapping="Wrap" Margin="0,8,0,10"/><TextBlock x:Name="TaskState" FontSize="12" Margin="0,0,0,12"/>
     <TextBlock x:Name="TaskDetail" TextWrapping="Wrap" Foreground="{DynamicResource BunnyMuted}" Margin="0,0,0,12"/><ProgressBar x:Name="TaskProgress" Height="4" Minimum="0" Maximum="1" Value="0" Visibility="Collapsed" Background="{DynamicResource BunnyField}" Foreground="{DynamicResource BunnyAccent}" BorderThickness="0" AutomationProperties.Name="Plan progress"/><TextBlock x:Name="StepCount" FontSize="12" Foreground="{DynamicResource BunnyMuted}" Margin="0,8,0,12"/>
     <TextBlock x:Name="ActivityDots" Text="&#8226; &#8226; &#8226;" FontSize="14" Foreground="{DynamicResource BunnyAccent}" Visibility="Collapsed" Margin="0,0,0,12"/>
     <StackPanel x:Name="ExpandedTask" Visibility="Collapsed"><TextBlock Text="LATEST COMMAND / OUTPUT" FontSize="11" Foreground="{DynamicResource BunnyMuted}" Margin="0,8,0,8"/><TextBox x:Name="Output" Height="136" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" FontFamily="Cascadia Mono, Consolas" FontSize="12" AutomationProperties.Name="Latest output"/><TextBlock x:Name="PlanSource" FontSize="12" TextWrapping="Wrap" Foreground="{DynamicResource BunnyMuted}" Margin="0,8,0,4"/></StackPanel>
     <WrapPanel Margin="0,12,0,0"><Button x:Name="OpenTaskButton" Content="Open task" Style="{DynamicResource SoftButton}" Margin="0,0,8,0"/><Button x:Name="ExpandButton" Content="Expand" Margin="0,0,8,0"/><Button x:Name="StopButton" Style="{DynamicResource DangerButton}"/><Button x:Name="TerminalButton" Content="Terminal unavailable" IsEnabled="False" ToolTipService.ShowOnDisabled="True" ToolTip="No supported terminal attachment path"/></WrapPanel>
     <WrapPanel x:Name="FileActions" Visibility="Collapsed" Margin="0,12,0,0"><Button x:Name="OpenFileButton" Content="Open" Style="{DynamicResource SoftButton}" Margin="0,0,8,0"/><Button x:Name="ShowFolderButton" Content="Show folder"/></WrapPanel>
    </StackPanel>
    <StackPanel x:Name="SystemPanel" Visibility="Collapsed"><TextBlock Text="This workstation" FontSize="21" FontWeight="SemiBold" Margin="0,0,0,12"/><TextBlock x:Name="SystemDetail" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap"/><StackPanel x:Name="Graphs"/><TextBlock Text="120-second trends. Gaps mean unavailable sensors." FontSize="12" Foreground="{DynamicResource BunnyMuted}" Margin="0,12,0,0"/></StackPanel>
    <StackPanel x:Name="ThermalPanel" Visibility="Collapsed"><TextBlock Text="THERMAL WARNING" Foreground="{DynamicResource BunnyWarning}" FontSize="11"/><TextBlock x:Name="ThermalName" FontSize="20" FontWeight="SemiBold" Margin="0,12,0,0"/><TextBlock x:Name="ThermalValue" Foreground="{DynamicResource BunnyWarning}" FontSize="42" Margin="0,8,0,12"/><TextBlock x:Name="ThermalDetail" TextWrapping="Wrap" Foreground="{DynamicResource BunnyMuted}"/><StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,20,0,0"><Button x:Name="ContinueButton" Content="Continue" Style="{DynamicResource SoftButton}" Margin="0,0,8,0"/><Button x:Name="ThermalStopButton" Content="Stop local task" Style="{DynamicResource DangerButton}"/></StackPanel><TextBlock Text="No task stops without your action." FontSize="12" Foreground="{DynamicResource BunnyMuted}" Margin="0,12,0,0"/></StackPanel>
    <StackPanel x:Name="MenuPanel" Visibility="Collapsed"><Button x:Name="OpenButton" Content="Open application" HorizontalAlignment="Stretch" HorizontalContentAlignment="Left"/><Button x:Name="ActiveTasksButton" Content="Active tasks" HorizontalAlignment="Stretch" HorizontalContentAlignment="Left"/><Button x:Name="PhoneButton" Content="Phone companion" HorizontalAlignment="Stretch" HorizontalContentAlignment="Left"/><Button x:Name="SettingsButton" Content="Appearance" HorizontalAlignment="Stretch" HorizontalContentAlignment="Left"/><Button x:Name="ThemeButton" Content="Switch theme" HorizontalAlignment="Stretch" HorizontalContentAlignment="Left"/><Button x:Name="CloseButton" Content="Close Island" HorizontalAlignment="Stretch" HorizontalContentAlignment="Left" ToolTip="Host-owned tasks keep running"/><TextBlock x:Name="OptionalProviders" FontSize="12" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" Margin="0,12,0,0"/></StackPanel>
    <StackPanel x:Name="PhonePanel" Visibility="Collapsed"><TextBlock Text="Your workstation, wherever you are." FontSize="21" FontWeight="SemiBold" TextWrapping="Wrap"/><TextBlock x:Name="PhoneDetail" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" Margin="0,12,0,16"/><TextBox x:Name="PhoneCode" IsReadOnly="True" TextWrapping="Wrap"/><Button x:Name="PairButton" Content="Create pairing code" Style="{DynamicResource PrimaryButton}" HorizontalAlignment="Right" Margin="0,16,0,0"/></StackPanel>
    <StackPanel x:Name="WeaponPanel" Visibility="Collapsed" Margin="0,0,0,4">
     <DockPanel><Image x:Name="WeaponHero" Width="64" Height="64" Stretch="Uniform" Margin="0,0,14,0" DockPanel.Dock="Left" RenderOptions.BitmapScalingMode="HighQuality" AutomationProperties.Name="Weapon character"/><StackPanel VerticalAlignment="Center"><TextBlock x:Name="WeaponTitle" FontSize="19" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock x:Name="WeaponWeapon" Foreground="{DynamicResource BunnyMuted}" FontSize="12" TextTrimming="CharacterEllipsis"/></StackPanel></DockPanel>
     <TextBlock x:Name="WeaponState" FontSize="15" FontWeight="SemiBold" Margin="0,12,0,2" TextWrapping="Wrap"/>
     <TextBlock x:Name="WeaponBasis" Foreground="{DynamicResource BunnyMuted}" FontSize="12" TextWrapping="Wrap" Margin="0,0,0,10"/>
     <TextBlock x:Name="WeaponContext" FontSize="12" TextWrapping="Wrap" Margin="0,0,0,6"/>
     <TextBlock x:Name="WeaponProgress" FontSize="12" Margin="0,0,0,4"/>
     <TextBlock x:Name="WeaponAttention" FontSize="12" Foreground="{DynamicResource BunnyMuted}" Margin="0,0,0,4"/>
     <TextBlock x:Name="WeaponFailure" Visibility="Collapsed" FontSize="12" Foreground="{DynamicResource BunnyNegative}" TextWrapping="Wrap" Margin="0,0,0,4"/>
     <TextBlock x:Name="WeaponTechnical" FontSize="11" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" Margin="0,8,0,12"/>
     <WrapPanel><Button x:Name="WeaponPause" Content="Pause" Visibility="Collapsed" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Pause this Agent"/><Button x:Name="WeaponResume" Content="Resume" Visibility="Collapsed" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Resume this Agent"/><Button x:Name="WeaponStop" Content="Stop" Visibility="Collapsed" Style="{DynamicResource DangerButton}" AutomationProperties.Name="Stop this Agent"/><Button x:Name="WeaponOpen" Content="Open in workspace" Visibility="Collapsed" Style="{DynamicResource SoftButton}" AutomationProperties.Name="Open this Agent in the workspace"/><Button x:Name="WeaponBack" Content="Back" Style="{DynamicResource BunnyButtonBase}" AutomationProperties.Name="Back to the Notch"/></WrapPanel>
    </StackPanel>
    <StackPanel x:Name="SettingsPanel" Visibility="Collapsed"><TextBlock Text="Make the Island yours." FontSize="21" FontWeight="SemiBold" Margin="0,0,0,16"/><ScrollViewer MaxHeight="480" VerticalScrollBarVisibility="Auto"><StackPanel>
     <TextBlock Text="Island size" Foreground="{DynamicResource BunnyMuted}"/><ComboBox x:Name="SizeChoice" MinHeight="44" Margin="0,4,0,12"/>
     <TextBlock Text="Island position" Foreground="{DynamicResource BunnyMuted}"/><ComboBox x:Name="PositionChoice" MinHeight="44" Margin="0,4,0,12"/>
     <TextBlock Text="Idle content" Foreground="{DynamicResource BunnyMuted}"/><ComboBox x:Name="IdleChoice" MinHeight="44" Margin="0,4,0,12"/>
     <TextBlock Text="Glass strength" Foreground="{DynamicResource BunnyMuted}"/><ComboBox x:Name="GlassChoice" MinHeight="44" Margin="0,4,0,12"/>
     <TextBlock Text="Auto-collapse after completion" Foreground="{DynamicResource BunnyMuted}"/><ComboBox x:Name="CollapseChoice" MinHeight="44" Margin="0,4,0,12"/>
     <TextBlock Text="Theme" Foreground="{DynamicResource BunnyMuted}"/><ComboBox x:Name="ThemeChoice" MinHeight="44" Margin="0,4,0,12"/>
     <TextBlock Text="Primary providers (up to three)" Foreground="{DynamicResource BunnyMuted}" Margin="0,4,0,8"/><WrapPanel x:Name="PrimaryChoices" MaxWidth="440"/>
    </StackPanel></ScrollViewer></StackPanel>
    <TextBlock x:Name="Notice" Foreground="{DynamicResource BunnyMuted}" TextWrapping="Wrap" FontSize="12" Margin="0,12,0,0"/>
    <Button x:Name="CollapseButton" Content="Collapse" Foreground="{DynamicResource BunnyMuted}" HorizontalAlignment="Right" Margin="0,8,0,0"/>
   </StackPanel></ScrollViewer>
    </StackPanel>
   </Border>
  </StackPanel>
 </Border>
</StackPanel>
'@
$bunnyVisualRoot=[Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($bunnyVisualXaml)); $bunnyWindow.Content=$bunnyVisualRoot
$bunnyControls=@{}
$bunnyNamespace=[System.Xml.XmlNamespaceManager]::new($bunnyVisualXaml.NameTable)
$bunnyNamespace.AddNamespace('x','http://schemas.microsoft.com/winfx/2006/xaml')
foreach ($node in $bunnyVisualXaml.SelectNodes('//*[@x:Name]', $bunnyNamespace)) { $name=$node.GetAttribute('Name','http://schemas.microsoft.com/winfx/2006/xaml'); $bunnyControls[$name]=$bunnyVisualRoot.FindName($name) }

function Save-BunnyPreferences { try { [IO.File]::WriteAllText($bunnyPreferencePath,($bunnyPreferences | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false)) } catch { $bunnyControls.Notice.Text='Appearance could not be saved.' } }
function Set-BunnyTheme([bool]$Light) {
 $script:bunnyLight=$Light
 $palette=if($Light){ @{BunnyText='#202B3C';BunnyMuted='#546278';BunnyField='#10374359';BunnyHover='#143E516D';BunnyPopup='#F4F8FE';BunnyAccent='#315F9F';BunnyAccentSoft='#19315F9F';BunnyOnAccent='#F7FAFF';BunnyPositive='#29734E';BunnyPositiveSoft='#1829734E';BunnyNegative='#AC3937';BunnyNegativeSoft='#18AC3937';BunnyWarning='#8C5D16';BunnyWarningSoft='#188C5D16';BunnySep='#263C506E';BunnySegment='#203C506E';BunnyClaude='#995831';BunnyGlass='#F0F4F8FE'} } else { @{BunnyText='#EFF2F8';BunnyMuted='#AAB3C3';BunnyField='#16ADBFDC';BunnyHover='#17B8CBEB';BunnyPopup='#18202C';BunnyAccent='#8EB9FF';BunnyAccentSoft='#2479A5F0';BunnyOnAccent='#14213A';BunnyPositive='#85CFA5';BunnyPositiveSoft='#1885CFA5';BunnyNegative='#F5A09D';BunnyNegativeSoft='#18F5A09D';BunnyWarning='#E6BF78';BunnyWarningSoft='#18E6BF78';BunnySep='#25C6D7F5';BunnySegment='#25C6D7F5';BunnyClaude='#E6B397';BunnyGlass='#ED181F2B'} }
 $palette.BunnyViolet=if($Light){'#6554A4'}else{'#AB9DF5'};$palette.BunnyGlass=if($Light){'#F0FFFDF9'}else{'#ED0F1728'};$palette.BunnyClaude=if($Light){'#995831'}else{'#E4A27C'}
 # The notch itself is black glass in both themes (Set-BunnyGlassSurface). Only the expanded panel surface follows the theme.
 $palette.BunnyPanel=if($Light){'#F4FBFCFF'}else{'#00000000'}
 # Visual Experience 2.0: a non-glass theme's validated colours replace the text, accent and panel roles. Status colours
 # (positive/negative/warning) keep their tested values, and High Contrast below still overrides everything.
 $theme=$script:bunnyUiTheme
 if($null-ne$theme-and$theme.Theme-ne'glass'){
  $tp=Get-BunnyNotchPalette $theme $Light 238
  foreach($key in @('BunnyText','BunnyMuted','BunnyAccent','BunnyOnAccent','BunnyAccentSoft','BunnySep','BunnySegment','BunnyField','BunnyHover','BunnyPopup','BunnyPanel')){$palette[$key]=$tp[$key]}
 }
 $bunnyWindow.FontFamily=[Windows.Media.FontFamily]::new($(if($null-ne$theme-and$theme.Theme-ne'glass'){$theme.Font+', Segoe UI'}else{'Segoe UI'}))
 if([Windows.SystemParameters]::HighContrast){
  $palette.BunnyText=[Windows.SystemColors]::WindowTextColor.ToString();$palette.BunnyMuted=$palette.BunnyText
  $palette.BunnyGlass=[Windows.SystemColors]::WindowColor.ToString();$palette.BunnySep=$palette.BunnyText;$palette.BunnyViolet=$palette.BunnyText
  # The panel surface must share the system palette the text was remapped to, or forced-colors text lands on the
  # theme's transparent/near-black surface and the expanded panel cannot be read (High Contrast White on dark).
  $palette.BunnyPanel=[Windows.SystemColors]::WindowColor.ToString()
 }
 # The header's local brushes were tuned for the always-black glass body and shadow the window palette. A themed body takes
 # the theme's own ink there too; glass and Windows High Contrast keep the accepted T13 header brushes.
 if($null-eq$script:bunnyHeaderDefaults){$script:bunnyHeaderDefaults=@{};foreach($key in @($bunnyControls.Header.Resources.Keys)){$script:bunnyHeaderDefaults[[string]$key]=$bunnyControls.Header.Resources[$key]}}
 $themedHeader=($null-ne$theme)-and($theme.Theme-ne'glass')-and(-not[Windows.SystemParameters]::HighContrast)
 foreach($key in @($script:bunnyHeaderDefaults.Keys)){$bunnyControls.Header.Resources[$key]=$(if($themedHeader-and$palette.ContainsKey($key)){New-BunnyBrush $palette[$key]}else{$script:bunnyHeaderDefaults[$key]})}
 foreach($key in $palette.Keys){$bunnyWindow.Resources[$key]=New-BunnyBrush $palette[$key]}
 $alpha=switch($bunnyPreferences.glass){'low'{250}'high'{218}default{238}};if([Windows.SystemParameters]::HighContrast){$alpha=255}
 $glass=$bunnyWindow.Resources['BunnyGlass'].Color;$glass.A=[byte]$alpha;$bunnyWindow.Resources['BunnyGlass']=[Windows.Media.SolidColorBrush]::new($glass)
 Set-BunnyGlassSurface
 foreach($key in $palette.Keys){$bunnyWindow.Resources[$key]=New-BunnyBrush $palette[$key]}
 $alpha=switch($bunnyPreferences.glass){'low'{250}'high'{218}default{238}};if([Windows.SystemParameters]::HighContrast){$alpha=255}
 $glass=$bunnyWindow.Resources['BunnyGlass'].Color;$glass.A=[byte]$alpha;$bunnyWindow.Resources['BunnyGlass']=[Windows.Media.SolidColorBrush]::new($glass)
 Set-BunnyGlassSurface
 if($bunnySnapshot){Draw-BunnyProviders}
}
function New-BunnyProviderIcon([string]$Id,[double]$Size){
 if($Id-notin@('codex','claude','ollama')){return (New-BunnyIcon $bunnyTiles[$Id][2] $Size)}
 $canvas=[Windows.Controls.Canvas]::new();$canvas.Width=24;$canvas.Height=24
 $ink=if([Windows.SystemParameters]::HighContrast){'BunnyText'}elseif($Id-eq'claude'){'BunnyClaude'}elseif($Id-eq'codex'){'BunnyAccent'}else{'BunnyText'}
 $count=if($Id-eq'claude'){12}elseif($Id-eq'codex'){6}else{1}
 $geometry=switch($Id){
  'claude'{'M12,2.5 V8.5'}
  'codex'{'M12,3.6 C17.6,.4 22.1,6.2 19.1,10.9 L12,15 V10.2 L16.2,7.8'}
  'ollama'{'M7.5,9.5 C5.5,6 5.5,1.5 7.5,2.5 L9.5,8 M14.5,8 L16.5,2.5 C18.5,1.5 18.5,6 16.5,9.5 M7.5,9.5 C5,11 4.5,14 5.5,17 L4.5,21 M16.5,9.5 C19,11 19.5,14 18.5,17 L19.5,21 M5.5,16.5 L8,15.5 V21 M18.5,16.5 L16,15.5 V21 M8.5,13.5 Q12,17 15.5,13.5 M9,11.5 H9.1 M14.9,11.5 H15'}
 }
 for($i=0;$i-lt$count;$i++){
  $path=[Windows.Shapes.Path]::new();$path.Data=[Windows.Media.Geometry]::Parse($geometry);$path.StrokeThickness=if($Id-eq'claude'){1.8}else{1.5};$path.StrokeStartLineCap='Round';$path.StrokeEndLineCap='Round';$path.StrokeLineJoin='Round';Set-BunnyRef $path ([Windows.Shapes.Shape]::StrokeProperty) $ink
  if($count-gt1){$path.RenderTransform=[Windows.Media.RotateTransform]::new(($i*360/$count),12,12)}
  [void]$canvas.Children.Add($path)
 }
 $box=[Windows.Controls.Viewbox]::new();$box.Width=$Size;$box.Height=$Size;$box.Child=$canvas;$box.IsHitTestVisible=$false;return $box
}
function New-BunnyTile([string]$Id,[double]$Size){
 $spec=$bunnyTiles[$Id];$tile=[Windows.Controls.Border]::new();$tile.Width=$Size;$tile.Height=$Size;$tile.CornerRadius=[Windows.CornerRadius]::new($Size/2);Set-BunnyRef $tile ([Windows.Controls.Border]::BackgroundProperty) 'BunnyField'
 $icon=New-BunnyProviderIcon $Id ($Size*.68);if($icon.Tag){Set-BunnyRef $icon.Tag ([Windows.Shapes.Shape]::StrokeProperty) 'BunnyText'};$icon.HorizontalAlignment='Center';$icon.VerticalAlignment='Center';$tile.Child=$icon;return $tile
}
# Primary work area only; multi-monitor placement is unsupported. Top and bottom are horizontal notches with the agent
# indicators on the left; left and right are vertical notches with the indicators above (Placement.ps1 owns the rule).
function Test-BunnyVertical { return ((ConvertTo-BunnyEdge $bunnyPreferences.edge) -in @('left', 'right')) }
function Get-BunnyIndicatorState([int]$Count) {
 $area=[Windows.SystemParameters]::WorkArea
 $probe=Get-BunnyPlacement -Edge (ConvertTo-BunnyEdge $bunnyPreferences.edge) -WorkArea @{Left=$area.Left;Top=$area.Top;Width=$area.Width;Height=$area.Height} -Size @{Width=1;Height=1}
 return (Get-BunnyIndicatorLayout -Placement $probe -AgentCount $Count)
}
function Set-BunnyPosition {
 # A drag in progress owns the position; the 2 s poll and the display events must not snap it back to the edge.
 if($script:bunnyDrag-and$script:bunnyDrag.Moved){return}
 $area=Get-BunnyTargetArea
 $edge=ConvertTo-BunnyEdge $bunnyPreferences.edge
 $vertical=Test-BunnyVertical
 $offset=switch($bunnyPreferences.position){'left'{0.0}'right'{1.0}default{$bunnyPreferences.edgeOffset}}
 # Logical size: the length along the edge and the thickness across it. Placement swaps the axes for vertical notches.
 # The target sizes are used so an animation in flight never places the notch from an intermediate frame.
 $width=if($script:bunnyTargetWidth){[double]$script:bunnyTargetWidth}else{[double]$bunnyWindow.Width}
 $height=if($script:bunnyTargetHeight){[double]$script:bunnyTargetHeight}else{[double]$bunnyWindow.Height}
 $size=if($vertical){@{Width=$height;Height=$width}}else{@{Width=$width;Height=$height}}
 $placement=Get-BunnyPlacement -Edge $edge -WorkArea @{Left=$area.Left;Top=$area.Top;Width=$area.Width;Height=$area.Height} -Size $size -Offset $offset
 $script:bunnyPlacement=$placement
 $bunnyWindow.Top=$placement.Top
 $bunnyWindow.Left=$placement.Left
}
# T13 monitors and docking. Device pixels convert to DIPs with the window's own composition scale (the monitor the Island
# is on); the pure rules (nearest edge, restore, expansion) live in Placement.ps1 and are unit-tested there.
function Get-BunnyDeviceScale {
 $source=[Windows.PresentationSource]::FromVisual($bunnyWindow)
 if(-not $source){return @{X=1.0;Y=1.0}}
 $matrix=$source.CompositionTarget.TransformToDevice;return @{X=[double]$matrix.M11;Y=[double]$matrix.M22}
}
function Convert-BunnyDevicePoint([double]$X,[double]$Y) {
 $source=[Windows.PresentationSource]::FromVisual($bunnyWindow)
 if(-not $source){return @{X=$X;Y=$Y}}
 $point=$source.CompositionTarget.TransformFromDevice.Transform([Windows.Point]::new($X,$Y));return @{X=$point.X;Y=$point.Y}
}
function Get-BunnyMonitors {
 Add-Type -AssemblyName System.Windows.Forms
 $scale=Get-BunnyDeviceScale;$list=@()
 foreach($screen in [Windows.Forms.Screen]::AllScreens){
  $area=$screen.WorkingArea;$dip=Convert-BunnyDeviceRect @{Left=$area.Left;Top=$area.Top;Width=$area.Width;Height=$area.Height} $scale.X $scale.Y
  $list+=@{Device=[string]$screen.DeviceName;WorkArea=$dip;Primary=[bool]$screen.Primary}
 }
 return $list
}
# The work area the Island is placed in: the saved monitor when it still matches, else the primary monitor. Before the
# window has a presentation source (first layout), the primary work area is used as before.
function Get-BunnyTargetArea {
 $primary=[Windows.SystemParameters]::WorkArea;$fallback=@{Left=$primary.Left;Top=$primary.Top;Width=$primary.Width;Height=$primary.Height}
 if(-not [Windows.PresentationSource]::FromVisual($bunnyWindow)){return $fallback}
 try{$chosen=Select-BunnyMonitor $bunnyPreferences.monitor @(Get-BunnyMonitors);if($chosen){return $chosen.WorkArea}}catch{}
 return $fallback
}
function Sync-BunnyEdgeChoice {
 $item=@($bunnyControls.EdgeChoice.Items|Where-Object {$_.Tag-eq$bunnyPreferences.edge})|Select-Object -First 1
 if($item){$script:bunnySettingsUpdating=$true;$bunnyControls.EdgeChoice.SelectedItem=$item;$script:bunnySettingsUpdating=$false}
}
function Sync-BunnyPositionChoice {
 $item=@($bunnyControls.PositionChoice.Items|Where-Object {$_.Tag-eq$bunnyPreferences.position})|Select-Object -First 1
 if($item){$script:bunnySettingsUpdating=$true;$bunnyControls.PositionChoice.SelectedItem=$item;$script:bunnySettingsUpdating=$false}
}
# Keyboard docking: Ctrl+Alt+Arrow moves the Island to that edge and re-centers it along that edge (position becomes
# 'center', the offset is kept; the monitor is kept). The Settings dropdowns are re-synced to what was saved.
function Set-BunnyDockEdge([string]$Edge) {
 $bunnyPreferences.edge=ConvertTo-BunnyEdge $Edge;$bunnyPreferences.position='center'
 Save-BunnyPreferences;Sync-BunnyEdgeChoice;Sync-BunnyPositionChoice;Resize-Bunny
}
function Test-BunnyDockKey($KeyArgs) {
 $edge=switch([string]$KeyArgs.Key){'Up'{'top'}'Down'{'bottom'}'Left'{'left'}'Right'{'right'}default{$null}}
 if(-not $edge){return $false}
 $both=[Windows.Input.ModifierKeys]::Control-bor[Windows.Input.ModifierKeys]::Alt
 if(([Windows.Input.Keyboard]::Modifiers-band$both)-ne$both){return $false}
 Set-BunnyDockEdge $edge;return $true
}
# Drag: press on the Notch body (never on a control), move more than 6 DIP, release to snap to the nearest edge of the
# monitor under the pointer. The window follows the pointer during the drag; the snap is applied only on release.
$script:bunnyDrag=$null
function Test-BunnyInteractive($Source) {
 $node=$Source -as [Windows.DependencyObject]
 while($node){
  if($node-is[Windows.Controls.Primitives.ButtonBase]-or$node-is[Windows.Controls.Primitives.TextBoxBase]-or$node-is[Windows.Controls.Primitives.Selector]-or$node-is[Windows.Controls.Primitives.ScrollBar]-or$node-is[Windows.Controls.ComboBox]){return $true}
  if($node-eq$bunnyControls.Glass){return $false}
  try{$node=[Windows.Media.VisualTreeHelper]::GetParent($node)}catch{return $true}
 }
 return $false
}
# A release snaps to the edge nearest the pointer. -DevicePoint is only for the evidence harness (synthetic release points);
# a real release reads the cursor.
function Invoke-BunnyDockRelease($DevicePoint) {
 $cursor=if($DevicePoint){$DevicePoint}else{[Windows.Forms.Cursor]::Position};$point=Convert-BunnyDevicePoint $cursor.X $cursor.Y
 $scale=Get-BunnyDeviceScale;$screen=[Windows.Forms.Screen]::FromPoint([Drawing.Point]::new([int]$cursor.X,[int]$cursor.Y))
 $area=$screen.WorkingArea;$work=Convert-BunnyDeviceRect @{Left=$area.Left;Top=$area.Top;Width=$area.Width;Height=$area.Height} $scale.X $scale.Y
 $vertical=Test-BunnyVertical;$size=if($vertical){@{Width=$bunnyWindow.ActualHeight;Height=$bunnyWindow.ActualWidth}}else{@{Width=$bunnyWindow.ActualWidth;Height=$bunnyWindow.ActualHeight}}
 $target=Get-BunnyNearestEdge -Point $point -WorkArea $work -Size $size
 $bunnyPreferences.edge=$target.Edge;$bunnyPreferences.edgeOffset=$target.Offset;$bunnyPreferences.position='center'
 $bunnyPreferences.monitor=@{device=[string]$screen.DeviceName;fingerprint=(Get-BunnyWorkAreaFingerprint $work)}
 Save-BunnyPreferences;Sync-BunnyEdgeChoice;Sync-BunnyPositionChoice;Resize-Bunny
}
Add-Type -AssemblyName System.Windows.Forms
$bunnyControls.Glass.Add_PreviewMouseLeftButtonDown({
 if(Test-BunnyInteractive $_.OriginalSource){return}
 $cursor=[Windows.Forms.Cursor]::Position;$point=Convert-BunnyDevicePoint $cursor.X $cursor.Y
 $script:bunnyDrag=@{X=[double]$cursor.X;Y=[double]$cursor.Y;GrabX=$point.X-$bunnyWindow.Left;GrabY=$point.Y-$bunnyWindow.Top;Moved=$false}
})
$bunnyControls.Glass.Add_PreviewMouseMove({
 $drag=$script:bunnyDrag
 if(-not $drag){return}
 if($_.LeftButton-ne[Windows.Input.MouseButtonState]::Pressed){$script:bunnyDrag=$null;return}
 $cursor=[Windows.Forms.Cursor]::Position;$scale=Get-BunnyDeviceScale
 $dx=([double]$cursor.X-$drag.X)/$scale.X;$dy=([double]$cursor.Y-$drag.Y)/$scale.Y
 if(-not$drag.Moved-and[Math]::Sqrt($dx*$dx+$dy*$dy)-le6){return}
 $drag.Moved=$true
 if(-not$bunnyControls.Glass.IsMouseCaptured){[void]$bunnyControls.Glass.CaptureMouse()}
 $point=Convert-BunnyDevicePoint $cursor.X $cursor.Y
 $bunnyWindow.Left=$point.X-$drag.GrabX;$bunnyWindow.Top=$point.Y-$drag.GrabY
})
$bunnyControls.Glass.Add_PreviewMouseLeftButtonUp({
 $drag=$script:bunnyDrag;$script:bunnyDrag=$null
 if($bunnyControls.Glass.IsMouseCaptured){$bunnyControls.Glass.ReleaseMouseCapture()}
 if(-not$drag-or-not$drag.Moved){return}
 $_.Handled=$true;Invoke-BunnyDockRelease
})
# The one structural change between the two orientations. Horizontal: [indicator column][body row].
# Vertical: [indicator row] above a column-shaped body when collapsed. An expanded vertical notch uses the row layout.
function Set-BunnyLayout([bool]$Expanded) {
 $vertical=Test-BunnyVertical
 $column=$vertical
 $script:bunnyColumn=$column
 $edge=ConvertTo-BunnyEdge $bunnyPreferences.edge
 $layout=Get-BunnyIndicatorState (Get-BunnyStripCellCount)
 $bunnyVisualRoot.Orientation=if($layout.Side -eq 'top'){'Vertical'}else{'Horizontal'}
 # One row of weapons beside a horizontal notch; one column above a collapsed vertical notch. An expanded vertical notch is a
 # wide card, so its weapons sit in one row above it.
 $bunnyControls.AgentStrip.Orientation=if($layout.Axis -eq 'row'){'Horizontal'}else{'Vertical'}
 $leftDock=if($column){'Top'}else{'Left'}
 $rightDock=if($column){'Bottom'}else{'Right'}
 foreach($element in @($bunnyControls.BunnyButton,$bunnyControls.VoiceButton,$bunnyControls.NotchBars,$bunnyControls.NotchStatus)){[Windows.Controls.DockPanel]::SetDock($element,$leftDock)}
 foreach($element in @($bunnyControls.ExtrasButton,$bunnyControls.SearchButton)){[Windows.Controls.DockPanel]::SetDock($element,$rightDock)}
 $bunnyControls.Header.Height=if($column){[double]::NaN}else{56}
 $bunnyControls.NotchStatus.MaxWidth=if($column){54}else{168}
 $bunnyControls.NotchStatus.TextAlignment=if($column){'Center'}else{'Left'}
 $bunnyControls.NotchStatus.FontSize=if($column){12}else{13}
 $bunnyControls.NotchBars.Margin=if($column){'0,2,0,4'}else{'0,0,8,0'}
 # The Bunny art: 56 DIP, inside the glass. It sits inset from the rounded end (10 DIP in the row, 8 DIP from the top in the
 # column) and its dark character well is clipped to a rounded square, so the baked square never breaks the capsule's curve.
 $artSize=56
 $bunnyControls.BunnyArt.Width=$artSize;$bunnyControls.BunnyArt.Height=$artSize
 $bunnyControls.BrandTile.Width=$artSize;$bunnyControls.BrandTile.Height=$artSize
 $bunnyControls.BunnyArt.Clip=[Windows.Media.RectangleGeometry]::new([Windows.Rect]::new(0,0,$artSize,$artSize),18,18)
 # Board notch-top: Bunny's ears rise a little above the body line. The 14 DIP glass margin above the body holds the lift, so the
 # art stays inside the window and clear of the screen edge (the 4 DIP safe margin is the window's own placement).
 $bunnyControls.BunnyButton.Margin=if($column){'0,8,0,0'}else{'10,-14,0,0'}
 $bunnyControls.Glass.Padding=if($column){'0,6'}else{'6,0'}
 $bunnyControls.Glass.CornerRadius=[Windows.CornerRadius]::new($(if($column){29}else{28}))
 # An expanded vertical notch: the header column and the panel sit side by side on one glass capsule (the board's left dock).
 $wide=[bool]($vertical -and $Expanded)
 $bunnyControls.GlassStack.Orientation=if($wide){'Horizontal'}else{'Vertical'}
 $bunnyControls.Header.Width=if($vertical){60}else{[double]::NaN}
 $bunnyControls.PanelSurface.Width=if($wide){440}else{[double]::NaN}
 $bunnyControls.PanelSurface.Margin=if($wide){'6,6,6,6'}else{'0,6,0,6'}
 $bunnyControls.PanelSurface.VerticalAlignment='Top'
 # Bottom edge with the panel open: the panel opens upward, so the header row moves below the panel (the notch stays on the edge).
 $header=$bunnyControls.Header;$inner=$bunnyControls.GlassStack
 $wantLast=[bool]($Expanded -and -not $vertical -and $edge -eq 'bottom')
 $isLast=[object]::ReferenceEquals($inner.Children[$inner.Children.Count-1],$header)
 if($wantLast -ne $isLast){[void]$inner.Children.Remove($header);if($wantLast){[void]$inner.Children.Add($header)}else{$inner.Children.Insert(0,$header)}}
 # Personal Agent strip: connected to the body on the same glass, same height as the Notch body.
 $strip=$bunnyControls.StripCapsule
 $stripBottom=[bool]($Expanded -and -not $vertical -and $edge -eq 'bottom')
 if($column){$strip.Width=58;$strip.Height=[double]::NaN;$strip.Margin='10,10,10,-22';$strip.HorizontalAlignment='Left';$strip.VerticalAlignment='Top';$strip.Padding='0,6'}
 else{$strip.Width=[double]::NaN;$strip.Height=58;$strip.Margin='0,14,-12,10';$strip.HorizontalAlignment='Left';$strip.VerticalAlignment=$(if($stripBottom){'Bottom'}else{'Top'});$strip.Padding='6,0'}
 Set-BunnyJoin
}
# Board dock-top: the agent capsule and the Notch are ONE continuous black-glass shape. Where they meet, the touching corners are
# square and the shared stroke is dropped, so no seam or gap shows. The strip is 58 DIP tall, the same as the Notch body, so the
# two gradients line up. Off (no strip shown): the Notch keeps its own rounded corners.
function Set-BunnyJoin {
 $strip=$bunnyControls.StripCapsule;$glass=$bunnyControls.Glass
 $vertical=Test-BunnyVertical
 # Visual Experience 2.0: corners and stroke come from the validated theme (the glass theme keeps the T13 values exactly).
 $r=Get-BunnyNotchRadius $script:bunnyUiTheme $vertical;$b=Get-BunnyNotchBorder $script:bunnyUiTheme ([Windows.SystemParameters]::HighContrast)
 $sr=[Math]::Max($r.TopLeft,$r.BottomLeft)
 if($null-eq$script:bunnyUiTheme-or$script:bunnyUiTheme.Theme-eq'glass'){$sr=29}
 if($strip.Visibility-ne'Visible'){
  $strip.CornerRadius=[Windows.CornerRadius]::new($sr);$strip.BorderThickness=[Windows.Thickness]::new($b)
  $glass.CornerRadius=[Windows.CornerRadius]::new($r.TopLeft,$r.TopRight,$r.BottomRight,$r.BottomLeft);$glass.BorderThickness=[Windows.Thickness]::new($b);return
 }
 if($script:bunnyColumn){
  # Column: the strip sits above the body, so its bottom corners and the body's top corners are the shared edge. The body's
  # top stroke is dropped there, otherwise a light line would divide the two shapes.
  $strip.CornerRadius=[Windows.CornerRadius]::new($sr,$sr,0,0);$strip.BorderThickness=[Windows.Thickness]::new($b,$b,$b,0)
  $glass.CornerRadius=[Windows.CornerRadius]::new(0,0,$r.BottomRight,$r.BottomLeft);$glass.BorderThickness=[Windows.Thickness]::new($b,0,$b,$b)
 }else{
  # Row: the strip sits to the left of the body, so its right corners and the body's left corners are the shared edge. The
  # body's left stroke is dropped for the same reason.
  $strip.CornerRadius=[Windows.CornerRadius]::new($sr,0,0,$sr);$strip.BorderThickness=[Windows.Thickness]::new($b,$b,0,$b)
  $glass.CornerRadius=[Windows.CornerRadius]::new(0,$r.TopRight,$r.BottomRight,0);$glass.BorderThickness=[Windows.Thickness]::new(0,$b,$b,$b)
 }
}
# The Notch is black glossy glass in both themes (spec section 11): #0B0D14 at 92 % with a gradient from #1A1E2B to #07080D,
# and a 1 px highlight brightest at the top edge. The same material joins the Personal Agent strip. No GPU effect here.
function Set-BunnyGlassSurface {
 # High Contrast: the fixed dark glass would put themed window text on an incompatible surface. Under forced colors
 # the surface follows the system window color, the same palette the text remap in Set-BunnyTheme uses, and the
 # stroke follows WindowTextColor - opaque, no glass simulation.
 if([Windows.SystemParameters]::HighContrast){
  $fill=[Windows.Media.SolidColorBrush]::new([Windows.SystemColors]::WindowColor);$fill.Freeze()
  $stroke=[Windows.Media.SolidColorBrush]::new([Windows.SystemColors]::WindowTextColor);$stroke.Freeze()
  $bunnyControls.Glass.Background=$fill;$bunnyControls.Glass.BorderBrush=$stroke
  $bunnyControls.StripCapsule.Background=$fill;$bunnyControls.StripCapsule.BorderBrush=$stroke
  return
 }
 # Visual Experience 2.0: a non-glass theme draws its own material from validated #rrggbb tokens (no GPU effect either).
 $theme=$script:bunnyUiTheme
 if($null-ne$theme-and$theme.Theme-ne'glass'){
  $alpha=switch($bunnyPreferences.glass){'low'{250}'high'{218}default{238}}
  $p=Get-BunnyNotchPalette $theme ([bool]$script:bunnyLight) $alpha
  $fill=[Windows.Media.LinearGradientBrush]::new();$fill.StartPoint=[Windows.Point]::new(0,0);$fill.EndPoint=[Windows.Point]::new(0,1)
  [void]$fill.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString($p.Fill),0))
  [void]$fill.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString($p.FillEnd),1))
  $fill.Freeze()
  $stroke=[Windows.Media.SolidColorBrush]::new([Windows.Media.ColorConverter]::ConvertFromString($(if($theme.Glow){$p.Glow}else{$p.Stroke})));$stroke.Freeze()
  $bunnyControls.Glass.Background=$fill;$bunnyControls.Glass.BorderBrush=$stroke
  $bunnyControls.StripCapsule.Background=$fill;$bunnyControls.StripCapsule.BorderBrush=$stroke
  return
 }
 $fill=[Windows.Media.LinearGradientBrush]::new();$fill.StartPoint=[Windows.Point]::new(0,0);$fill.EndPoint=[Windows.Point]::new(0,1)
 [void]$fill.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString('#EB1A1E2B'),0))
 [void]$fill.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString('#EB07080D'),1))
 $fill.Freeze()
 $stroke=[Windows.Media.LinearGradientBrush]::new();$stroke.StartPoint=[Windows.Point]::new(0,0);$stroke.EndPoint=[Windows.Point]::new(0,1)
 [void]$stroke.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString('#24FFFFFF'),0))
 [void]$stroke.GradientStops.Add([Windows.Media.GradientStop]::new([Windows.Media.ColorConverter]::ConvertFromString('#0AFFFFFF'),1))
 $stroke.Freeze()
 $bunnyControls.Glass.Background=$fill;$bunnyControls.Glass.BorderBrush=$stroke
 $bunnyControls.StripCapsule.Background=$fill;$bunnyControls.StripCapsule.BorderBrush=$stroke
}
function Get-BunnyElapsed($Task) {
 if($null-eq$Task.startedAt){return [string][char]0x2014}
 $end=if($null-ne$Task.finishedAt){$Task.finishedAt}else{[DateTimeOffset]::Now.ToUnixTimeMilliseconds()}
 $seconds=[Math]::Max(0,[Math]::Floor(($end-$Task.startedAt)/1000));$hours=[Math]::Floor($seconds/3600)
 return $(if($hours-gt0){'{0}:{1:00}:{2:00}'-f$hours,([Math]::Floor($seconds/60)%60),($seconds%60)}else{'{0:00}:{1:00}'-f[Math]::Floor($seconds/60),($seconds%60)})
}
function Set-BunnyHeight([double]$Height) {
 if($script:bunnyTargetHeight-eq$Height){return}
 $script:bunnyTargetHeight=$Height;$from=$bunnyWindow.ActualHeight;$bunnyWindow.BeginAnimation([Windows.Window]::HeightProperty,$null);$bunnyWindow.Height=$Height
 if($bunnyAnimate-and$from-gt0){$animation=[Windows.Media.Animation.DoubleAnimation]::new($from,$Height,[Windows.Duration]::new([TimeSpan]::FromMilliseconds($bunnyMotion.morph)));$animation.FillBehavior='Stop';$animation.EasingFunction=[Windows.Media.Animation.CubicEase]::new();$animation.EasingFunction.EasingMode='EaseOut';$bunnyWindow.BeginAnimation([Windows.Window]::HeightProperty,$animation)}
}
# Experimental backdrop blur (SetWindowCompositionAttribute). Opt-in: the preference blur=acrylic turns it on; the default
# is the alpha glass above. A failed call returns false and leaves the alpha glass in place.
$bunnyAcrylicSource = @'
using System;
using System.Runtime.InteropServices;
namespace Bunny.Glass {
  public static class Acrylic {
    [StructLayout(LayoutKind.Sequential)] public struct AccentPolicy { public int AccentState; public int AccentFlags; public int GradientColor; public int AnimationId; }
    [StructLayout(LayoutKind.Sequential)] public struct WindowCompositionAttributeData { public int Attribute; public IntPtr Data; public int SizeOfData; }
    [DllImport("user32.dll")] public static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);
    public static bool Apply(IntPtr hwnd, int accentState, int gradientAbgr) {
      AccentPolicy policy = new AccentPolicy();
      policy.AccentState = accentState; policy.AccentFlags = 2; policy.GradientColor = gradientAbgr; policy.AnimationId = 0;
      int size = Marshal.SizeOf(typeof(AccentPolicy));
      IntPtr ptr = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(policy, ptr, false);
        WindowCompositionAttributeData data = new WindowCompositionAttributeData();
        data.Attribute = 19; data.Data = ptr; data.SizeOfData = size;
        return SetWindowCompositionAttribute(hwnd, ref data) != 0;
      } finally { Marshal.FreeHGlobal(ptr); }
    }
  }
}
'@
function Enable-BunnyBlur([int]$AccentState = 4, [string]$Tint = '#3DFFFFFF') {
 try {
  if (-not ('Bunny.Glass.Acrylic' -as [type])) { Add-Type -TypeDefinition $bunnyAcrylicSource -Language CSharp }
  $hwnd = ([Windows.Interop.WindowInteropHelper]::new($bunnyWindow)).Handle
  if ($hwnd -eq [IntPtr]::Zero) { return $false }
  $color = [Windows.Media.ColorConverter]::ConvertFromString($Tint)
  $abgr = ([int]$color.A -shl 24) -bor ([int]$color.B -shl 16) -bor ([int]$color.G -shl 8) -bor [int]$color.R
  return [Bunny.Glass.Acrylic]::Apply($hwnd, $AccentState, $abgr)
 } catch { return $false }
}
# WPF can leave the window's HWND at its previous height after a content-driven height change (the content is measured at the
# new height, but the window keeps the old one until another size change arrives). Flush pending work, and if the window still
# disagrees with the target, step it one DIP down and back so the HWND takes the target size.
function Sync-BunnyWindowHeight([double]$Height) {
 # The flush is skipped while the dispatcher is suspended (inside a nested frame); the step itself is always safe.
 try{$bunnyWindow.Dispatcher.Invoke([Action]{},[Windows.Threading.DispatcherPriority]::Background)}catch{}
 if([Math]::Abs($bunnyWindow.ActualHeight-$Height)-lt1){return}
 $bunnyWindow.Height=$Height-1;$bunnyWindow.Height=$Height
}
function Resize-Bunny {
 # A minimized WPF window restores itself the moment its Width/Height are set, so sizing waits for a visible window
 # and keeps the live-measured minimized motion suppression (IR-M5) in force.
 if($bunnyWindow.WindowState-eq'Minimized'){$script:bunnyExpanded=($bunnyView-ne'idle');return}
 $expanded=$bunnyView-ne'idle';$script:bunnyExpanded=$expanded
 $bunnyControls.Details.Visibility=if($expanded){'Visible'}else{'Collapsed'}
 $bunnyControls.DetailsScroll.Visibility=$bunnyControls.Details.Visibility
 $bunnyControls.PanelSurface.Visibility=$bunnyControls.Details.Visibility
 # The collapsed Notch has one fixed height: the task, mission, Agent, health and voice cards wait for the expanded panel.
 $bunnyControls.CompactVoice.Visibility='Collapsed'
 if(-not $expanded){foreach($name in @('CompactTask','CompactHealth','CompactMission','CompactAgent')){$bunnyControls[$name].Visibility='Collapsed'}}
 $area=Get-BunnyTargetArea
 $vertical=Test-BunnyVertical
 Set-BunnyLayout $expanded
 $bunnyControls.DetailsScroll.MaxHeight=[Math]::Max(240,$area.Height-144)
 $bunnyControls.DetailsScroll.Height=[double]::NaN
 $strip=$bunnyControls.AgentStrip.Visibility-eq'Visible'
 # Logical body width. A horizontal Notch adds the strip beside it; a collapsed vertical Notch is 78 DIP thick (58 DIP of glass
 # and its margins); an expanded panel is 540 DIP wide.
 $body=if($expanded){540}elseif($vertical){78}else{switch($bunnyPreferences.size){'compact'{420}'detailed'{470}default{440}}}
 $extra=if($strip-and-not$vertical){Get-BunnyStripExtent}else{0}
 $width=[Math]::Min($body+$extra,$area.Width-24)
 $bunnyControls.Glass.Width=if($vertical){[double]::NaN}else{$body}
 if($script:bunnyTargetWidth-ne$width){$script:bunnyTargetWidth=$width;$from=$bunnyWindow.ActualWidth;$bunnyWindow.BeginAnimation([Windows.Window]::WidthProperty,$null);$bunnyWindow.Width=$width;if($bunnyAnimate-and$from-gt0){$animation=[Windows.Media.Animation.DoubleAnimation]::new($from,$width,[Windows.Duration]::new([TimeSpan]::FromMilliseconds($bunnyMotion.morph)));$animation.FillBehavior='Stop';$animation.EasingFunction=[Windows.Media.Animation.CubicEase]::new();$animation.EasingFunction.EasingMode='EaseOut';$bunnyWindow.BeginAnimation([Windows.Window]::WidthProperty,$animation)}}
 Set-BunnyPosition
 # Flush pending visibility and child changes before measuring the new view.
 $bunnyWindow.UpdateLayout()
 # The window height is the measured height of the whole Notch (strip, body and the expanded panel). The panel ScrollViewer caps
 # its own height, so nothing is clipped at the bottom of the panel (the Collapse button always has its row).
 $bunnyVisualRoot.Measure([Windows.Size]::new($width,[double]::PositiveInfinity))
 $height=[Math]::Min($bunnyVisualRoot.DesiredSize.Height,$area.Height-12)
 Set-BunnyHeight $height
 Set-BunnyPosition
 Sync-BunnyWindowHeight $height
}
function Set-BunnyView([string]$View) {
 $script:bunnyView=$View
 foreach($entry in @{composer='ComposerPanel';routing='RoutingPanel';approval='ApprovalPanel';tasks='TasksPanel';task='TaskPanel';system='SystemPanel';thermal='ThermalPanel';menu='MenuPanel';phone='PhonePanel';settings='SettingsPanel';constellation='ConstellationPanel';voice='NativeVoicePanel';weapon='WeaponPanel';quick='QuickPanel'}.GetEnumerator()){if($bunnyControls[$entry.Value]){$bunnyControls[$entry.Value].Visibility=if($entry.Key-eq$View){'Visible'}else{'Collapsed'}}}
 if($View-eq'quick'){Update-BunnyQuickPanel}
 $bunnyControls.CompactTask.Visibility=if($View-eq'idle'-and$bunnySelectedId){'Visible'}else{'Collapsed'}
 $bunnyControls.ExtrasButton.ToolTip=if($View-eq'idle'){'Quick controls'}else{'Collapse Island'}
 Set-BunnyButton $bunnyControls.ExtrasButton '' $(if($View-eq'idle'){'grid'}else{'x'}) 17
 Resize-Bunny
 if(Get-Command Update-BunnyMotion -ErrorAction SilentlyContinue){Update-BunnyMotion;Resize-Bunny}
 if($bunnyAnimate-and$View-ne'idle'){$fade=[Windows.Media.Animation.DoubleAnimation]::new(0.5,1,[Windows.Duration]::new([TimeSpan]::FromMilliseconds($bunnyMotion.content)));$bunnyControls.Details.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)}
}
function Close-BunnyDetails {
 $weapon = if ($bunnyView -eq 'weapon') { $script:bunnyWeaponDetailSlot } else { $null }
 $script:bunnyWeaponStopConfirm = $null
 Set-BunnyView 'idle'
 if ($null -ne $weapon -and $script:bunnyWeaponChips.ContainsKey([int]$weapon) -and $script:bunnyWeaponChips[[int]$weapon].IsVisible) { [void]$script:bunnyWeaponChips[[int]$weapon].Focus() }
 else { [void]$bunnyControls.ExtrasButton.Focus() }
}
# Icons for the header: the grid (quick controls) and the search (open workspace). Same 24-unit stroked set as the rest.
$bunnyIcons['grid'] = 'M 3,3 H 10 V 10 H 3 Z M 14,3 H 21 V 10 H 14 Z M 14,14 H 21 V 21 H 14 Z M 3,14 H 10 V 21 H 3 Z'
$bunnyIcons['search'] = 'M 11,3 A 8,8 0 1 0 11,19 A 8,8 0 1 0 11,3 Z M 21,21 L 16.65,16.65'
$script:bunnySlotRows = @{}
function Get-BunnySlotRecord([int]$SlotId) {
 return @($bunnySnapshot.personalAgents.slots | Where-Object { $_ -and [int]$_.slot -eq $SlotId }) | Select-Object -First 1
}
function Invoke-BunnySlotRow([int]$SlotId) {
 # A bound slot opens its detail card; an unassigned slot sends the user to Studio to set it up (never a success message).
 $slot = Get-BunnySlotRecord $SlotId
 if ($slot -and $slot.active -and $slot.agentId) { Show-BunnyWeaponDetail $SlotId } else { Open-BunnyDashboard '?view=agentic' }
}
function New-BunnySlotRow([int]$SlotId) {
 # Real Buttons expose their identity and action to UI Automation and support standard Tab/Enter/Space behavior.
 $row = New-BunnyCharacterButton 14; $row.Padding = [Windows.Thickness]::new(8, 6, 8, 6); $row.Margin = [Windows.Thickness]::new(0, 0, 0, 6)
 $row.BorderThickness = [Windows.Thickness]::new(0); $row.Background = [Windows.Media.Brushes]::Transparent
 $row.Cursor = [Windows.Input.Cursors]::Hand; $row.Focusable = $true; $row.Tag = $SlotId
 $grid = [Windows.Controls.DockPanel]::new()
 $art = [Windows.Controls.Image]::new(); $art.Width = 30; $art.Height = 44; $art.Stretch = 'Uniform'; $art.VerticalAlignment = 'Center'; $art.HorizontalAlignment = 'Center'; $art.Margin = [Windows.Thickness]::new(0, 0, 16, 0); [Windows.Controls.DockPanel]::SetDock($art, 'Left')
 [Windows.Media.RenderOptions]::SetBitmapScalingMode($art, [Windows.Media.BitmapScalingMode]::HighQuality)
 $stack = [Windows.Controls.StackPanel]::new(); $stack.VerticalAlignment = 'Center'
 $name = [Windows.Controls.TextBlock]::new(); $name.FontWeight = 'SemiBold'; $name.TextTrimming = 'CharacterEllipsis'
 $state = [Windows.Controls.TextBlock]::new(); $state.FontSize = 12; $state.TextTrimming = 'CharacterEllipsis'; $state.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty, 'BunnyMuted')
 [void]$stack.Children.Add($name); [void]$stack.Children.Add($state)
 [void]$grid.Children.Add($art); [void]$grid.Children.Add($stack); $row.Content = $grid
 $row.Add_MouseEnter({ $this.SetResourceReference([Windows.Controls.Control]::BackgroundProperty, 'BunnyHover') })
 $row.Add_MouseLeave({ $this.Background = [Windows.Media.Brushes]::Transparent })
 $row.Add_GotKeyboardFocus({ $this.SetResourceReference([Windows.Controls.Control]::BorderBrushProperty, 'BunnyAccent'); $this.BorderThickness = [Windows.Thickness]::new(2) })
 $row.Add_LostKeyboardFocus({ $this.BorderThickness = [Windows.Thickness]::new(0) })
 $row.Add_Click({ Invoke-BunnySlotRow ([int]$this.Tag) })
 $script:bunnySlotRows[$SlotId] = @{ Row = $row; Art = $art; Name = $name; State = $state }
 return $row
}
function Update-BunnyQuickPanel {
 $c = $bunnyControls
 if ($c.SlotRows.Children.Count -eq 0) { foreach ($id in 1..4) { [void]$c.SlotRows.Children.Add((New-BunnySlotRow $id)) } }
 $pending = 0; $dash = [string][char]0x2014
 foreach ($id in 1..4) {
  $row = $script:bunnySlotRows[$id]; $slot = Get-BunnySlotRecord $id
  $bound = [bool]($slot -and $slot.active -and $slot.agentId)
  if ($slot -and $slot.attention) { $pending += [int]$slot.attention.pendingApprovals }
  $base = if ($bound) { $script:BunnyWeaponBase[[string]$slot.weapon] } else { $null }
  $source = if ($base) { Get-BunnyCharacterSource $base.Compact 96 } else { $null }
  if ($row.Art.Source -ne $source) { $row.Art.Source = $source }
  $title = if ($slot -and $slot.displayName) { [string]$slot.displayName } else { 'Slot ' + $id }
  $label = if (-not $bound) { 'Not assigned ' + $dash + ' set up in Studio' } elseif ($slot.presentation) { [string]$slot.presentation.label } else { 'Status unknown' }
  # A retained snapshot is not live: while the Host is offline a bound row says so (the weapon chips and the card do the same).
  if ($bound -and -not $bunnyOnline) { $label = 'Last known: ' + $label }
  $row.Name.Text = $title; $row.State.Text = $label
  $row.Row.Opacity = if ($bound) { 1 } else { 0.5 }
  $name = $title + ', ' + $label; $row.Row.ToolTip = $name; [Windows.Automation.AutomationProperties]::SetName($row.Row, $name)
 }
 $c.QuickApprovals.Content = if ($pending) { 'Approvals: ' + $pending } else { 'No approvals waiting' }
 $c.QuickHost.Text = if ($bunnyOnline) { '' } else { 'Host offline. Showing the last known state; commands are unavailable.' }
 $c.QuickHost.Visibility = if ($bunnyOnline) { 'Collapsed' } else { 'Visible' }
 $c.QuickVoiceState.Text = 'Voice: ' + [string]$c.VoiceHeadline.Text
 $c.QuickVoice.IsEnabled = [bool]$bunnyOnline
}
function Show-BunnyMenu {
 $bunnyControls.OptionalProviders.Text = @($bunnySnapshot.providers | Where-Object extension | ForEach-Object { $_.name + ' ' + $bunnyDot + ' ' + $_.availability.Replace('_', ' ') }) -join "`n"
 Set-BunnyView 'menu'
}
function Expand-Bunny { if($bunnySelectedId){Show-BunnyTask;Set-BunnyView $(if((@($bunnySnapshot.tasks|Where-Object id -eq $bunnySelectedId)|Select-Object -First 1).state-eq'waiting_for_approval'){'approval'}else{'task'})}else{Set-BunnyView 'composer'} }
function Draw-BunnyProviders {
 $bunnyControls.Providers.Children.Clear()
 if($bunnyPreferences.idle-eq'clock'-and$bunnyView-eq'idle'){$text=[Windows.Controls.TextBlock]::new();$text.Text=(Get-Date -Format 'HH:mm');$text.VerticalAlignment='Center';[void]$bunnyControls.Providers.Children.Add($text);return}
 if($bunnyPreferences.idle-eq'temperatures'-and$bunnyView-eq'idle'){Add-BunnyMicroTelemetry $bunnyControls.Providers;return}
 if($bunnyPreferences.idle-in@('minimal','tasks')-and$bunnyView-eq'idle'){$text=[Windows.Controls.TextBlock]::new();$text.Text=switch($bunnyPreferences.idle){'tasks'{[string]@($bunnySnapshot.tasks|Where-Object state -notin @('completed','failed','stopped')).Count+' active'}default{'Bunny-A'}};$text.VerticalAlignment='Center';Set-BunnyRef $text ([Windows.Controls.TextBlock]::ForegroundProperty) 'BunnyMuted';[void]$bunnyControls.Providers.Children.Add($text);return}
 foreach($id in @($bunnyPreferences.primary|Select-Object -First 3)){
  $provider=@($bunnySnapshot.providers|Where-Object id -eq $id)|Select-Object -First 1;if(-not$provider){continue}
  $icon=[Windows.Controls.Grid]::new();$icon.Width=38;$icon.Height=38
  $windows=if($id-eq'ollama'){@()}else{@($provider.usageWindows|Where-Object {$null-ne$_.usedPercent})}
  $short=@($windows|Where-Object kind -eq 'short')|Select-Object -First 1;$weekly=@($windows|Where-Object kind -eq 'weekly')|Select-Object -First 1
  $outer=if($weekly){$weekly}elseif($short){$short}elseif($windows.Count){$windows[0]}else{$null};$inner=if($short-and$weekly){$short}else{$null}
  $ringInk=if($id-eq'claude'){'BunnyClaude'}else{'BunnyAccent'};if($outer){Add-BunnyRing $icon 18 ([Math]::Max(0,[Math]::Min(100,$outer.usedPercent))) $ringInk};if($inner){Add-BunnyRing $icon 14 ([Math]::Max(0,[Math]::Min(100,$inner.usedPercent))) $ringInk}
  $tile=New-BunnyTile $id 24;$tile.HorizontalAlignment='Center';$tile.VerticalAlignment='Center';[void]$icon.Children.Add($tile)
  $status=if(-not$bunnyOnline){'offline'}else{$provider.availability};$statusKey=switch($status){'ready'{'BunnyPositive'}'busy'{'BunnyAccent'}'authentication_required'{'BunnyWarning'}'rate_limited'{'BunnyWarning'}default{'BunnyMuted'}}
  $dot=[Windows.Controls.TextBlock]::new();$dot.Text=switch($status){'ready'{[string][char]0x2713}'busy'{[string][char]0x2022}'authentication_required'{'!'}default{[string][char]0x00D7}};$dot.FontSize=10;$dot.HorizontalAlignment='Right';$dot.VerticalAlignment='Bottom';Set-BunnyRef $dot ([Windows.Controls.TextBlock]::ForegroundProperty) $statusKey;[void]$icon.Children.Add($dot)
  $button=[Windows.Controls.Button]::new();$button.Width=44;$button.Height=44;$button.Padding='0';$button.Content=$icon;$button.Tag=$id
  $usage=if($id-eq'ollama'){'Model: '+$(if($provider.current_model){$provider.current_model}else{'Unavailable'})+"`nVRAM: "+$(if($provider.vram){$provider.vram}else{'Unavailable'})+"`nTokens/sec: "+$(if($null-ne$provider.tokens_per_sec){$provider.tokens_per_sec}else{'Unavailable'})}elseif($windows.Count){@($windows|ForEach-Object {$_.label+': '+$_.usedPercent+'% used; reset '+$(if($_.resetsAt){[DateTimeOffset]::FromUnixTimeMilliseconds([long]$_.resetsAt).ToLocalTime().ToString('g')}else{'Unavailable'})})-join"`n"}else{'Quota unavailable'}
  $button.ToolTip=$provider.name+' '+$bunnyDot+' '+$status.Replace('_',' ')+"`n"+$usage+"`nActive jobs: "+$provider.active_jobs+"`nVersion: "+$(if($provider.version){$provider.version}else{'Unavailable'})+$(if($provider.usageObservedAt){"`nReported "+[DateTimeOffset]::FromUnixTimeMilliseconds([long]$provider.usageObservedAt).ToLocalTime().ToString('g')}else{''})
  [Windows.Automation.AutomationProperties]::SetName($button,$button.ToolTip)
  $button.Add_Click({$bunnyControls.OptionalProviders.Text=$this.ToolTip;Set-BunnyView 'menu'})
  [void]$bunnyControls.Providers.Children.Add($button)
 }
 if($bunnyPreferences.idle-eq'mixed'-and$bunnyView-eq'idle'){Add-BunnyMicroTelemetry $bunnyControls.Providers -CpuOnly}
}
function Populate-BunnyTasks {
 $selected=$bunnySelectedId;$script:bunnyUpdating=$true;$bunnyControls.Tasks.Items.Clear()
 foreach($task in @($bunnySnapshot.tasks|Where-Object state -notin @('completed','failed','stopped'))){$item=[Windows.Controls.ListBoxItem]::new();$item.Content=New-BunnyTaskRow $task;$item.Tag=$task.id;[void]$bunnyControls.Tasks.Items.Add($item);if($task.id-eq$selected){$item.IsSelected=$true}}
 $bunnyControls.ActiveText.Text=[string]$bunnyControls.Tasks.Items.Count+' active';$script:bunnyUpdating=$false
}
function Get-BunnyVerifiedFile($Task){
 if($Task.state-ne'completed'-or-not$Task.verification.passed-or-not$Task.verify-or-not$Task.cwd){return $null}
 $folder=[IO.Path]::GetFullPath($Task.cwd);$path=[IO.Path]::GetFullPath((Join-Path $folder $Task.verify.name))
 if(-not$path.StartsWith($folder.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)-or-not(Test-Path -LiteralPath $path -PathType Leaf)){return $null};return $path
}
function Show-BunnyTask {
 $task=@($bunnySnapshot.tasks|Where-Object id -eq $bunnySelectedId)|Select-Object -First 1;if(-not$task){return}
 $provider=@($bunnySnapshot.providers|Where-Object id -eq $task.provider)|Select-Object -First 1;$info=Get-BunnyStateInfo $task.state;$waiting=$task.state-eq'waiting_for_approval';$live=$task.state-notin@('completed','failed','stopped','waiting_for_approval')
 $safe=Get-BunnyTaskPresentation $task
 $bunnyControls.TaskProvider.Text=Get-BunnyProviderName $task.provider;$bunnyControls.Elapsed.Text=Get-BunnyElapsed $task;$bunnyControls.TaskTitle.Text=$task.title;$bunnyControls.TaskState.Text=$safe.label;Set-BunnyRef $bunnyControls.TaskState ([Windows.Controls.TextBlock]::ForegroundProperty) $info.Ink
 $bunnyControls.CompactTitle.Text=(Get-BunnyProviderName $task.provider)+' '+$bunnyDot+' '+$task.title;$bunnyControls.CompactTime.Text=Get-BunnyElapsed $task;$bunnyControls.CompactActivity.Text=$safe.activity
 $bunnyControls.TaskDetail.Text=$safe.activity+"`n"+$safe.verification+"`n"+$safe.detail
 $bunnyControls.TaskDetail.MaxHeight=104;$bunnyControls.TaskDetail.ToolTip=$safe.detail
 $planned=$task.progress-and$task.progress.kind-eq'determinate'-and$task.progress.total-gt0-and$task.progress.completed-ge0-and$task.progress.completed-le$task.progress.total-and[double]$task.progress.total-eq[Math]::Floor([double]$task.progress.total)-and[double]$task.progress.completed-eq[Math]::Floor([double]$task.progress.completed)
 $bunnyControls.TaskProgress.IsIndeterminate=$false;$bunnyControls.TaskProgress.Visibility=if($live-and$planned){'Visible'}else{'Collapsed'}
 if($planned){$bunnyControls.TaskProgress.Maximum=$task.progress.total;$bunnyControls.TaskProgress.Value=$task.progress.completed;$bunnyControls.StepCount.Text=[string]$task.progress.completed+' / '+$task.progress.total+' steps';$bunnyControls.PlanSource.Text='Provider plan'}else{$bunnyControls.StepCount.Text='';$bunnyControls.PlanSource.Text='No finite plan reported.'}
 $bunnyControls.StepCount.Visibility=if($live-and$planned){'Visible'}else{'Collapsed'};$bunnyControls.ActivityDots.Visibility=if($live-and-not$planned){'Visible'}else{'Collapsed'}
 $bunnyControls.Output.Text='Provider transcripts remain on the Host. Open the application for files and verification.';$bunnyControls.ExpandedTask.Visibility=if($bunnyTaskExpanded){'Visible'}else{'Collapsed'}
 $bunnyControls.StopButton.Visibility=if($live){'Visible'}else{'Collapsed'};$bunnyControls.StopButton.IsEnabled=$bunnyOnline-and-not$bunnyPending;$bunnyControls.TerminalButton.Visibility=if($live-and$bunnyTaskExpanded){'Visible'}else{'Collapsed'};$bunnyControls.TerminalButton.IsEnabled=$false
 $bunnyControls.ExpandButton.Content=if($bunnyTaskExpanded){'Less'}elseif($task.state-eq'failed'){'Details'}else{'Expand'}
 $file=Get-BunnyVerifiedFile $task;$bunnyControls.FileActions.Visibility=if($file){'Visible'}else{'Collapsed'};$bunnyControls.OpenFileButton.Tag=$file;$bunnyControls.ShowFolderButton.Tag=$file
 if($waiting){$bunnyControls.ApprovalTitle.Text='Use '+$(if($task.provider-eq'claude'){'Claude'}else{Get-BunnyProviderName $task.provider})+'?';$bunnyControls.ApprovalReason.Text=$task.decision.reason;$bunnyControls.ApprovalRequirements.Text=@($task.decision.requirements)-join' '+$bunnyDot+' ';$bunnyControls.ApprovalProvider.Text=Get-BunnyProviderName $task.provider;$bunnyControls.ApprovalStatus.Text=$(if($task.manual){'Your selection'}else{'Best match'})+' '+$bunnyDot+' '+$provider.availability.Replace('_',' ');$bunnyControls.Scores.Text=@($task.decision.scores|ForEach-Object {(Get-BunnyProviderName $_.provider)+'    '+([double]$_.score).ToString('0.00')})-join"`n";$bunnyControls.ApproveButton.IsEnabled=$bunnyOnline-and-not$bunnyPending-and$provider.availability-in@('ready','busy')}
 if($waiting-and$task.provider-eq'ollama'-and$task.model-match':cloud$'){$bunnyControls.ApprovalReason.Text=$task.decision.reason.Replace('Stays on this machine. ','');$bunnyControls.ApprovalRequirements.Text+="`n"+$task.model+' '+$bunnyDot+' runs through Ollama cloud';if($task.constraints.localOnly-or$task.constraints.offlineOnly){$bunnyControls.ApproveButton.IsEnabled=$false;$bunnyControls.ApprovalRequirements.Text+="`nCloud model conflicts with the local-only constraint."}}
 $signature=$task.id+':'+$task.state
 if($signature-ne$bunnySeenTaskState){if($task.state-in@('completed','failed','stopped')-and$bunnySeenTaskState.StartsWith($task.id+':')){$script:bunnyFinishedAt=[DateTimeOffset]::Now.ToUnixTimeMilliseconds();Set-BunnyView 'task'};$script:bunnySeenTaskState=$signature}
 if(Get-Command Draw-BunnyJourney -ErrorAction SilentlyContinue){Draw-BunnyJourney $task}
}
function Draw-BunnyGraph([string]$Label,$Values,[string]$Unit){
 $width=$bunnyWindow.Width-72;$height=42;$head=[Windows.Controls.DockPanel]::new();$head.Margin='0,16,0,6';$last=@($Values)|Select-Object -Last 1;$value=[Windows.Controls.TextBlock]::new();$value.Text=if($null-ne$last){([Math]::Round([double]$last)).ToString()+$Unit}else{'Unavailable'};[Windows.Controls.DockPanel]::SetDock($value,'Right');[void]$head.Children.Add($value);$title=[Windows.Controls.TextBlock]::new();$title.Text=$Label;Set-BunnyRef $title ([Windows.Controls.TextBlock]::ForegroundProperty) 'BunnyMuted';[void]$head.Children.Add($title);[void]$bunnyControls.Graphs.Children.Add($head)
 $canvas=[Windows.Controls.Canvas]::new();$canvas.Width=$width;$canvas.Height=$height;$points=[Windows.Media.PointCollection]::new();$count=@($Values).Count
 # Keep unavailable intervals as gaps, instead of connecting the last known value across them.
 for($i=0;$i-le$count;$i++){if($i-lt$count-and$null-ne$Values[$i]){[void]$points.Add([Windows.Point]::new($i*$width/[Math]::Max(1,$count-1),$height-4-[Math]::Max(0,[Math]::Min(100,[double]$Values[$i]))*($height-8)/100))}else{if($points.Count-gt1){$line=[Windows.Shapes.Polyline]::new();$line.Points=$points;$line.StrokeThickness=1.5;Set-BunnyRef $line ([Windows.Shapes.Shape]::StrokeProperty) 'BunnyAccent';[void]$canvas.Children.Add($line)};$points=[Windows.Media.PointCollection]::new()}}
 [void]$bunnyControls.Graphs.Children.Add($canvas)
}
function Show-BunnySystem {
 $sample=@($bunnySnapshot.samples)|Select-Object -Last 1;$bunnyControls.Graphs.Children.Clear();if(-not$sample){$bunnyControls.SystemDetail.Text='Telemetry unavailable.';return}
 $when=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$sample.at).ToLocalTime().ToString('T');$cpuTemp=if($null-eq$sample.cpu.temperatureC){'Temperature unavailable'}else{[string]$sample.cpu.temperatureC+[char]0x00B0+'C'};$clock=if($null-ne$sample.cpu.clockMhz){[string]([Math]::Round($sample.cpu.clockMhz/1000,2))+' GHz '+$bunnyDot+' '}else{''}
 $bunnyControls.SystemDetail.Text=$clock+$cpuTemp+"`nMemory "+([Math]::Round($sample.memory.usedBytes/1GB,1))+' / '+([Math]::Round($sample.memory.totalBytes/1GB,1))+' GB'+"`n"+$(if($bunnyOnline){'Updated '}else{'Last reading '})+$when
 $history=@($bunnySnapshot.samples|Where-Object {$_.at-ge($sample.at-120000)})
 Draw-BunnyGraph 'CPU' @($history|ForEach-Object {$_.cpu.utilization}) '%';Draw-BunnyGraph 'Memory' @($history|ForEach-Object {if($_.memory.totalBytes-gt0){100*$_.memory.usedBytes/$_.memory.totalBytes}else{$null}}) '%'
 foreach($gpu in $sample.gpus){$name=$gpu.name;Draw-BunnyGraph $name @($history|ForEach-Object {$g=@($_.gpus|Where-Object name -eq $name)|Select-Object -First 1;$g.utilization}) '%';$note=[Windows.Controls.TextBlock]::new();$note.Text=$(if($null-eq$gpu.temperatureC){'Temperature unavailable'}else{[string]$gpu.temperatureC+[char]0x00B0+'C'})+$(if($null-ne$gpu.memoryUsedBytes-and$null-ne$gpu.memoryTotalBytes){' '+$bunnyDot+' '+([Math]::Round($gpu.memoryUsedBytes/1GB,1))+' / '+([Math]::Round($gpu.memoryTotalBytes/1GB,1))+' GB VRAM'}else{''});$note.FontSize=12;Set-BunnyRef $note ([Windows.Controls.TextBlock]::ForegroundProperty) 'BunnyMuted';[void]$bunnyControls.Graphs.Children.Add($note)}
}
function Update-BunnyRouteState {$bunnyControls.RouteButton.IsEnabled=$bunnyOnline-and-not$bunnyPending-and$bunnyControls.Prompt.Text.Trim().Length-gt0;$bunnyControls.CancelButton.IsEnabled=$bunnyOnline-and-not$bunnyPending;$bunnyControls.ChangeButton.IsEnabled=$bunnyOnline-and-not$bunnyPending;if($bunnyPending){$bunnyControls.ApproveButton.IsEnabled=$false;$bunnyControls.StopButton.IsEnabled=$false}}
function Update-Bunny {
 try{$script:bunnySnapshot=Invoke-Bunny;$script:bunnyOnline=$true;Update-BunnyUiTheme;$script:bunnyLastError=$null;$bunnyControls.Presence.Text='Host online '+$bunnyDot+' approval before launch';Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyPositive'
  # While the window is iconic, Host data is still polled but the UI rebuild/animation work waits (spec section 10:
  # invisible work is throttled). The next visible tick, at most 2 s after restore, replays this block. Update-BunnyMotion
  # still runs every tick so motion mode keeps tracking the real window state.
  if($bunnyWindow.WindowState-ne'Minimized'){
    $active=@($bunnySnapshot.tasks|Where-Object state -notin @('completed','failed','stopped'));if(-not$bunnySelectedId-and$active.Count){$script:bunnySelectedId=$active[0].id};Populate-BunnyTasks;Show-BunnyTask
    $sample=@($bunnySnapshot.samples)|Select-Object -Last 1;$temperatures=@();if($sample){if($null-ne$sample.cpu.temperatureC){$temperatures+=$sample.cpu.temperatureC};$temperatures+=@($sample.gpus|Where-Object {$null-ne$_.temperatureC}|ForEach-Object {$_.temperatureC})};$bunnyControls.Temperature.Text=if($temperatures.Count){[string]($temperatures|Measure-Object -Maximum).Maximum+[char]0x00B0}else{''}
    $hot=$null;if($sample-and([DateTimeOffset]::Now.ToUnixTimeMilliseconds()-$sample.at)-lt15000){foreach($gpu in $sample.gpus){if($null-ne$gpu.temperatureC-and$gpu.temperatureC-ge$bunnySnapshot.thermal.gpuWarn){$hot=@{name=$gpu.name;temperature=$gpu.temperatureC;key='gpu:'+ $gpu.name};break}};if(-not$hot-and$null-ne$sample.cpu.temperatureC-and$sample.cpu.temperatureC-ge$bunnySnapshot.thermal.cpuWarn){$hot=@{name='CPU';temperature=$sample.cpu.temperatureC;key='cpu'}}};$script:bunnyHot=$hot
    if($hot){$local=@($active|Where-Object {$_.provider-eq'ollama'-and$_.model-and$_.model-notmatch':cloud$'-and$_.state-in@('running','launching','verifying')});$bunnyControls.ThermalName.Text=$hot.name;$bunnyControls.ThermalValue.Text=[string]$hot.temperature+[char]0x00B0+'C';$bunnyControls.ThermalDetail.Text=if($local.Count){'Ollama '+$bunnyDot+' '+$local[0].model+"`nLocal Ollama generation is active"}else{'Above your configured warning threshold.'};$bunnyControls.ThermalStopButton.IsEnabled=$local.Count-eq1;$bunnyControls.ThermalStopButton.Tag=if($local.Count-eq1){$local[0].id}else{$null};if($hot.key-ne$bunnyHeatDismissed-and$bunnyView-notin@('composer','routing')){Set-BunnyView 'thermal'}}else{$script:bunnyHeatDismissed=$null}
    if($bunnyView-eq'system'){Show-BunnySystem};Draw-BunnyProviders;Update-BunnyRouteState
    if($bunnyFinishedAt-and$bunnyPreferences.collapse-gt0-and$bunnyView-eq'task'-and([DateTimeOffset]::Now.ToUnixTimeMilliseconds()-$bunnyFinishedAt)-ge($bunnyPreferences.collapse*1000)){$script:bunnySelectedId=$null;$script:bunnyFinishedAt=$null;Set-BunnyView 'idle'}
    if($bunnyView-eq'idle'-and-not$active.Count-and-not$bunnyFinishedAt){$script:bunnySelectedId=$null;$bunnyControls.CompactTask.Visibility='Collapsed'}elseif($bunnyView-eq'idle'-and$active.Count){$bunnyControls.CompactTask.Visibility='Visible'}
    Update-BunnyPresentation
    Update-BunnyAgentStrip
    Update-BunnyVoice
    Update-BunnyCompanion
    Update-BunnyWeaponDetail
    if($bunnyView-eq'quick'){Update-BunnyQuickPanel}
    Resize-Bunny
  }
  Update-BunnyMotion
 }catch{$script:bunnyOnline=$false;$script:bunnyLastError=$_.Exception.Message;$bunnyControls.Presence.Text='Host unavailable - retained work may be stale';$bunnyControls.CompactHealth.Text='Host unavailable - retained work may be stale';$bunnyControls.CompactHealth.Visibility='Visible';Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyMuted';$bunnyControls.Temperature.Text='';$bunnyControls.ApproveButton.IsEnabled=$false;$bunnyControls.StopButton.IsEnabled=$false;Update-BunnyAgentPresentation;Update-BunnyAgentStrip;Update-BunnyVoice;Update-BunnyCompanion;if($bunnyView-eq'quick'){Update-BunnyQuickPanel};Resize-Bunny;Update-BunnyRouteState;Draw-BunnyProviders;Update-BunnyMotion}
}
# Async UI commands keep the morph/animation and keyboard responsive; execution stays in the Host.
function Begin-BunnyCommand([string]$Action,$Data){
 if($Action-eq'approve'){$target=@($bunnySnapshot.tasks|Where-Object id -eq $Data.id)|Select-Object -First 1;if($target.provider-eq'ollama'-and$target.model-match':cloud$'-and($target.constraints.localOnly-or$target.constraints.offlineOnly)){$bunnyControls.Notice.Text='This cloud model conflicts with your local-only constraint. Change the route or cancel.';return}}
 if($bunnyPending){return};$credentials=Get-Content -LiteralPath $bunnyCredentialPath -Raw|ConvertFrom-Json;$client=[Net.WebClient]::new();$client.Headers['Authorization']='Bearer '+$credentials.token;$client.Headers['Content-Type']='application/json';$client.Encoding=[Text.Encoding]::UTF8
 $script:bunnyPending=@{client=$client;action=$Action;task=$client.UploadStringTaskAsync([Uri]('http://127.0.0.1:'+$credentials.port+'/command'),'POST',(@{action=$Action;data=$Data}|ConvertTo-Json -Depth 8 -Compress));at=[DateTimeOffset]::Now.ToUnixTimeMilliseconds()};Update-BunnyRouteState
 $bunnyCommandTimer.Start()
}
$bunnyCommandTimer=[Windows.Threading.DispatcherTimer]::new();$bunnyCommandTimer.Interval=[TimeSpan]::FromMilliseconds(80);$bunnyCommandTimer.Add_Tick({
 if(-not$bunnyPending){$bunnyCommandTimer.Stop();return}
 if(-not$bunnyPending.task.IsCompleted){if(([DateTimeOffset]::Now.ToUnixTimeMilliseconds()-$bunnyPending.at)-gt12000){$bunnyPending.client.CancelAsync()};return}
 $pending=$bunnyPending;$script:bunnyPending=$null;$bunnyCommandTimer.Stop()
 try{if($pending.task.IsFaulted){throw $pending.task.Exception.GetBaseException()};$result=$pending.task.Result|ConvertFrom-Json;$script:bunnySnapshot=$result.snapshot;if($result.task){$script:bunnySelectedId=$result.task.id};if($pending.action-eq'submit'){$bunnyControls.Prompt.Clear();$script:bunnyTaskExpanded=$false;Set-BunnyView 'approval'}elseif($pending.action-eq'approve'){Set-BunnyView 'task'};Update-Bunny}catch{$bunnyControls.Notice.Text=Get-BunnyError $_;if($bunnyView-eq'routing'){Set-BunnyView 'composer'}}finally{$pending.client.Dispose()}
})
function Add-BunnyChoice($Control,$Options,[string]$Key){foreach($pair in $Options){$item=[Windows.Controls.ComboBoxItem]::new();$item.Content=$pair[1];$item.Tag=$pair[0];[void]$Control.Items.Add($item);if([string]$pair[0]-eq[string]$bunnyPreferences[$Key]){$Control.SelectedItem=$item}};$Control.Tag=$Key;$Control.Add_SelectionChanged({if($bunnySettingsUpdating-or-not$this.SelectedItem){return};$bunnyPreferences[$this.Tag]=$this.SelectedItem.Tag;Save-BunnyPreferences;Apply-BunnyAppearance;Resize-Bunny})}
function Apply-BunnyAppearance { $windowsLight=try{(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize').AppsUseLightTheme-eq1}catch{$false};$light=Get-BunnyThemeLight $script:bunnyUiTheme ([string]$bunnyPreferences.theme) $windowsLight;Set-BunnyTheme $light;Set-BunnyPosition;if(Get-Command Update-BunnyMotion -ErrorAction SilentlyContinue){$script:bunnyOrbState='';Update-BunnyMotion} }
$bunnySettingsUpdating=$true
. (Join-Path $PSScriptRoot 'Bunny-Island.Theme.ps1')
$script:bunnyUiTheme=$null;$script:bunnyUiThemeKey='default'
# Restyles the Notch only when the Host's theme actually changed. Offline, the last applied theme stays (never a flash).
function Update-BunnyUiTheme {
 if($null-eq$bunnySnapshot){return}
 $theme=Get-BunnyNotchTheme $bunnySnapshot.uiTheme;$key=Get-BunnyNotchThemeKey $theme
 if($key-eq$script:bunnyUiThemeKey){return}
 $script:bunnyUiTheme=$theme;$script:bunnyUiThemeKey=$key
 Apply-BunnyAppearance;Set-BunnyJoin
}
. (Join-Path $PSScriptRoot 'Bunny-Island.Voice.ps1')
. (Join-Path $PSScriptRoot 'Bunny-Island.Motion.ps1')
. (Join-Path $PSScriptRoot 'Bunny-Island.Presentation.ps1')
. (Join-Path $PSScriptRoot 'Bunny-Island.Weapons.ps1')
. (Join-Path $PSScriptRoot 'Bunny-Island.Companion.ps1')
Initialize-BunnyCompanion
Add-BunnyChoice $bunnyControls.SizeChoice @(@('compact','Compact'),@('normal','Normal'),@('detailed','Detailed')) 'size'
Add-BunnyChoice $bunnyControls.PositionChoice @(@('left','Start'),@('center','Center'),@('right','End')) 'position'
Add-BunnyChoice $bunnyControls.IdleChoice @(@('providers','Agents'),@('temperatures','System'),@('tasks','Active tasks'),@('clock','Clock'),@('mixed','Mixed'),@('minimal','Minimal')) 'idle'
Add-BunnyChoice $bunnyControls.GlassChoice @(@('low','Low'),@('medium','Medium'),@('high','High')) 'glass'
Add-BunnyChoice $bunnyControls.CollapseChoice @(@(5,'5 sec'),@(10,'10 sec'),@(30,'30 sec'),@(0,'Never')) 'collapse'
Add-BunnyChoice $bunnyControls.ThemeChoice @(@('system','System'),@('dark','Dark'),@('light','Light')) 'theme'
$edgeLabel=New-BunnyCaption 'Island edge';$edgeChoice=[Windows.Controls.ComboBox]::new();$edgeChoice.Margin='0,4,0,12';$bunnyControls.EdgeChoice=$edgeChoice;$settingsStack=$bunnyControls.ThemeChoice.Parent;$themeIndex=$settingsStack.Children.IndexOf($bunnyControls.ThemeChoice);$settingsStack.Children.Insert($themeIndex+1,$edgeLabel);$settingsStack.Children.Insert($themeIndex+2,$edgeChoice)
Add-BunnyChoice $edgeChoice @(@('top','Top'),@('bottom','Bottom'),@('left','Left'),@('right','Right')) 'edge'
# Display changes re-place the Island on the primary work area; the event is delivered on a system thread, so marshal it.
$bunnyWindow.Add_SourceInitialized({if($bunnyPreferences.blur-eq'acrylic'){[void](Enable-BunnyBlur)}})
$bunnyWindow.Add_SourceInitialized({try{$script:bunnyDisplayHandler=[EventHandler]{$bunnyWindow.Dispatcher.BeginInvoke([Action]{Resize-Bunny})|Out-Null};[Microsoft.Win32.SystemEvents]::add_DisplaySettingsChanged($script:bunnyDisplayHandler)}catch{}})
$bunnyWindow.Add_Closed({try{[Microsoft.Win32.SystemEvents]::remove_DisplaySettingsChanged($script:bunnyDisplayHandler)}catch{}})
try{$bunnyWindow.Add_DpiChanged({Resize-Bunny})}catch{}
foreach($id in @('codex','claude','ollama','opencode','cline','cursor')){$check=[Windows.Controls.CheckBox]::new();$check.Content=(Get-Culture).TextInfo.ToTitleCase($id);$check.Tag=$id;Set-BunnyRef $check ([Windows.Controls.Control]::ForegroundProperty) 'BunnyText';$check.Margin='0,0,16,8';$check.MinHeight=44;$check.VerticalContentAlignment='Center';$check.IsChecked=$bunnyPreferences.primary-contains$id;$check.Add_Click({$chosen=@($bunnyControls.PrimaryChoices.Children|Where-Object IsChecked|ForEach-Object {$_.Tag});if($chosen.Count-gt3){$this.IsChecked=$false;return};$bunnyPreferences.primary=$chosen;Save-BunnyPreferences;Draw-BunnyProviders});[void]$bunnyControls.PrimaryChoices.Children.Add($check)}
$bunnySettingsUpdating=$false
Set-BunnyButton $bunnyControls.SearchButton '' 'search' 17;Set-BunnyButton $bunnyControls.RouteButton 'Route' 'arrow-right';Set-BunnyButton $bunnyControls.ApproveButton 'Approve & Run' 'play';Set-BunnyButton $bunnyControls.StopButton 'Stop' 'square'
Apply-BunnyAppearance;if($LightView){Set-BunnyTheme $true}
Set-BunnyMotionMode
$bunnyWindow.Add_SizeChanged({Set-BunnyPosition})
function Sync-BunnyMotionVisibility {
 Set-BunnyMotionMode
 if(-not$bunnyAnimate){Stop-BunnyWeaponStrip;Stop-BunnyCompanionMotion;$script:bunnyCompanionKey=''}
 else{Update-BunnyAgentStrip;Update-BunnyCompanion}
}
$bunnyWindow.Add_StateChanged({Sync-BunnyMotionVisibility})
$bunnyWindow.Add_IsVisibleChanged({Sync-BunnyMotionVisibility})
$bunnyControls.BunnyButton.Add_Click({if($bunnyHeld){$script:bunnyHeld=$false;return};Set-BunnyView 'composer';$bunnyControls.Prompt.Focus()|Out-Null})
$bunnyControls.CollapseButton.Add_Click({Close-BunnyDetails});$bunnyControls.ExtrasButton.Add_Click({if($bunnyView-eq'idle'){Set-BunnyView 'quick'}else{Close-BunnyDetails}})
$bunnyControls.SearchButton.Add_Click({Open-BunnyApplication ''})
$bunnyControls.QuickVoice.Add_Click({Set-BunnyView 'voice'})
$bunnyControls.QuickWorkspace.Add_Click({Open-BunnyApplication ''})
$bunnyControls.QuickApprovals.Add_Click({Open-BunnyDashboard '?view=agentic'})
$bunnyControls.QuickMore.Add_Click({Show-BunnyMenu})
$bunnyControls.CompactTask.Add_Click({if(@($bunnySnapshot.tasks|Where-Object state -notin @('completed','failed','stopped')).Count-gt1){Set-BunnyView 'tasks'}else{Expand-Bunny}})
$bunnyControls.Prompt.Add_TextChanged({Update-BunnyRouteState})
$bunnyControls.RouteButton.Add_Click({try{$project=$bunnyControls.ProjectChoice.SelectedItem.Tag;$route=$bunnyControls.RouteChoice.SelectedItem.Tag;Set-BunnyView 'routing';Begin-BunnyCommand 'submit' @{prompt=$bunnyControls.Prompt.Text;mode=@('fast','balanced','deep')[$bunnyControls.Mode.SelectedIndex];projectId=$project;override=$route;constraints=@{localOnly=[bool]$bunnyControls.LocalOnly.IsChecked}}}catch{$bunnyControls.Notice.Text=Get-BunnyError $_;Set-BunnyView 'composer'}})
$bunnyControls.ApproveButton.Add_Click({Begin-BunnyCommand 'approve' @{id=$bunnySelectedId}});$bunnyControls.StopButton.Add_Click({Begin-BunnyCommand 'stop' @{id=$bunnySelectedId}});$bunnyControls.CancelButton.Add_Click({Begin-BunnyCommand 'stop' @{id=$bunnySelectedId}})
$bunnyControls.ChangeButton.Add_Click({
 $task=@($bunnySnapshot.tasks|Where-Object id -eq $bunnySelectedId)|Select-Object -First 1
 $script:bunnyUpdating=$true
 try {
  $bunnyControls.ChangeProvider.Items.Clear()
  foreach($id in $task.decision.eligible_providers){$item=[Windows.Controls.ComboBoxItem]::new();$item.Content=Get-BunnyProviderName $id;$item.Tag=$id;[void]$bunnyControls.ChangeProvider.Items.Add($item);if($id-eq$task.provider){$bunnyControls.ChangeProvider.SelectedItem=$item}}
 } finally {$script:bunnyUpdating=$false}
 $bunnyControls.ChangeProvider.Visibility='Visible';Resize-Bunny
})
$bunnyControls.ChangeProvider.Add_SelectionChanged({if($this.SelectedItem-and-not$bunnyUpdating){Begin-BunnyCommand 'retarget' @{id=$bunnySelectedId;provider=$this.SelectedItem.Tag};$this.Visibility='Collapsed'}})
$bunnyControls.ExpandButton.Add_Click({$script:bunnyTaskExpanded=-not$bunnyTaskExpanded;Show-BunnyTask;Resize-Bunny})
$bunnyControls.Tasks.Add_SelectionChanged({if(-not$bunnyUpdating-and$this.SelectedItem){$script:bunnySelectedId=$this.SelectedItem.Tag;Expand-Bunny}})
$bunnyControls.SystemButton.Add_Click({Set-BunnyView 'system';Show-BunnySystem;Resize-Bunny});$bunnyControls.ActiveTasksButton.Add_Click({Populate-BunnyTasks;Set-BunnyView 'tasks'});$bunnyControls.SettingsButton.Add_Click({Set-BunnyView 'settings'})
$bunnyControls.CloseButton.Add_Click({$bunnyWindow.Close()});$bunnyControls.ThemeButton.Add_Click({$bunnyPreferences.theme=if($bunnyLight){'dark'}else{'light'};Save-BunnyPreferences;Apply-BunnyAppearance})
function Open-BunnyApplication([string]$TaskId){$query=if($TaskId){'?task='+[Uri]::EscapeDataString($TaskId)}else{''};Open-BunnyDashboard $query}
$bunnyControls.OpenButton.Add_Click({Open-BunnyApplication ''});$bunnyControls.OpenTaskButton.Add_Click({Open-BunnyApplication $bunnySelectedId})
$bunnyControls.OpenFileButton.Add_Click({$task=@($bunnySnapshot.tasks|Where-Object id -eq $bunnySelectedId)|Select-Object -First 1;$file=Get-BunnyVerifiedFile $task;if($file){Start-Process -FilePath $file}})
$bunnyControls.ShowFolderButton.Add_Click({$task=@($bunnySnapshot.tasks|Where-Object id -eq $bunnySelectedId)|Select-Object -First 1;$file=Get-BunnyVerifiedFile $task;if($file){Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"'+$file+'"')}})
$bunnyControls.PhoneButton.Add_Click({$bunnyControls.PhoneDetail.Text=if($bunnySnapshot.remoteConfigured){'Open the secure companion and enter a one-time code.'}else{'Secure phone access is not configured.'};$bunnyControls.PairButton.IsEnabled=$bunnyOnline-and$bunnySnapshot.remoteConfigured;Set-BunnyView 'phone'})
$bunnyControls.PairButton.Add_Click({try{$result=Invoke-Bunny 'pairing.create' @{};$bunnyControls.PhoneCode.Text=$result.snapshot.remoteUrl+'/?companion=1'+"`n`n"+$result.pairCode;$bunnyControls.Notice.Text='Single use '+$bunnyDot+' expires in 10 minutes';Resize-Bunny}catch{$bunnyControls.Notice.Text=Get-BunnyError $_}})
$bunnyControls.ContinueButton.Add_Click({$script:bunnyHeatDismissed=$bunnyHot.key;Close-BunnyDetails});$bunnyControls.ThermalStopButton.Add_Click({if($this.Tag){Begin-BunnyCommand 'stop' @{id=$this.Tag}}})
$bunnyWindow.Add_PreviewKeyDown({if(Test-BunnyDockKey $_){$_.Handled=$true}elseif($_.Key-eq'Escape'){Close-BunnyDetails;$_.Handled=$true}elseif($_.Key-eq'Return'-and([Windows.Input.Keyboard]::Modifiers-band[Windows.Input.ModifierKeys]::Control)){if($bunnyView-eq'composer'-and$bunnyControls.RouteButton.IsEnabled){Invoke-BunnyClick $bunnyControls.RouteButton};$_.Handled=$true}elseif($_.Key-in@('Up','Down')-and$bunnyView-in@('idle','task','tasks')){Move-BunnyFocus $(if($_.Key-eq'Down'){1}else{-1});$_.Handled=$true}})
function Move-BunnyFocus([int]$Direction){$active=@($bunnySnapshot.tasks|Where-Object state -notin @('completed','failed','stopped'));if(-not$active.Count){return};$index=0;for($i=0;$i-lt$active.Count;$i++){if($active[$i].id-eq$bunnySelectedId){$index=$i}};$script:bunnySelectedId=$active[($index+$Direction+$active.Count)%$active.Count].id;Show-BunnyTask;if($active.Count-gt1){Populate-BunnyTasks;Set-BunnyView 'tasks'}else{Expand-Bunny}}
$bunnyWindow.Add_MouseWheel({if($bunnyView-in@('idle','task','tasks')){Move-BunnyFocus $(if($_.Delta-lt0){1}else{-1});$_.Handled=$true}})
function Populate-BunnyComposer {
 $bunnyControls.ProjectChoice.Items.Clear();$auto=[Windows.Controls.ComboBoxItem]::new();$auto.Content='Auto';$auto.Tag=$null;[void]$bunnyControls.ProjectChoice.Items.Add($auto);foreach($p in $bunnySnapshot.projects){$item=[Windows.Controls.ComboBoxItem]::new();$item.Content=$p.name;$item.Tag=$p.id;[void]$bunnyControls.ProjectChoice.Items.Add($item)};$bunnyControls.ProjectChoice.SelectedIndex=0
 $bunnyControls.RouteChoice.Items.Clear();$auto=[Windows.Controls.ComboBoxItem]::new();$auto.Content='Auto';$auto.Tag='auto';[void]$bunnyControls.RouteChoice.Items.Add($auto);foreach($p in @($bunnySnapshot.providers|Where-Object availability -in @('ready','busy'))){$item=[Windows.Controls.ComboBoxItem]::new();$item.Content=$p.name;$item.Tag=$p.id;[void]$bunnyControls.RouteChoice.Items.Add($item)};$bunnyControls.RouteChoice.SelectedIndex=0
}
$bunnyTimer=[Windows.Threading.DispatcherTimer]::new();$bunnyTimer.Interval=[TimeSpan]::FromSeconds(2);$bunnyTimer.Add_Tick({Update-Bunny});$bunnyTimer.Start()
$bunnyWindow.Add_Closed({$bunnyTimer.Stop();$bunnyCommandTimer.Stop();if($bunnyPending){$bunnyPending.client.CancelAsync();$bunnyPending.client.Dispose()}})
$bunnyWindow.Add_Loaded({Update-Bunny;Populate-BunnyComposer;if($SystemView){Set-BunnyView 'system';Show-BunnySystem}else{Set-BunnyView 'idle'}})
Set-BunnyView 'idle'
$bunnySmokeFailed=$false
if($SmokeTest){$smokeTimer=[Windows.Threading.DispatcherTimer]::new();$smokeTimer.Interval=[TimeSpan]::FromSeconds(3);$smokeTimer.Add_Tick({$smokeTimer.Stop();try{if($TestHook){. $TestHook}else{if($CollapsedView){Close-BunnyDetails}elseif($SystemView){Set-BunnyView 'system';Show-BunnySystem}else{Expand-Bunny};Resize-Bunny;[void](Save-BunnyScreenshot $(if($CollapsedView){'bunny-native-collapsed'}elseif($LightView){'bunny-native-light'}elseif($SystemView){'bunny-native-system'}else{'bunny-native-island'}))};if($bunnyLastError){throw $bunnyLastError}}catch{[Console]::Error.WriteLine('Island smoke failed: '+$_.Exception.Message+' @ '+$_.InvocationInfo.PositionMessage);$script:bunnySmokeFailed=$true}finally{$bunnyWindow.Close()}});$smokeTimer.Start()}
[void]$bunnyWindow.ShowDialog();if($bunnySmokeFailed){exit 1}
