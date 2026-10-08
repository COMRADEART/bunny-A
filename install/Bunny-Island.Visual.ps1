# Dot-sourced UI layer. Invoke-Bunny continues to use the existing authenticated Host contract.
function Invoke-BunnyClick($Control) { if(-not$Control.IsEnabled){throw ('Control is disabled: '+$Control.Name)};$Control.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Primitives.ButtonBase]::ClickEvent,$Control)) }
function Save-BunnyScreenshot([string]$Name) {
 $directory=if($ScreenshotDirectory){$ScreenshotDirectory}else{Join-Path $Root 'screenshots'};[void](New-Item -ItemType Directory -Path $directory -Force);Resize-Bunny;$bunnyWindow.UpdateLayout()
 # A WPF resize reaches the HWND on the next dispatcher pass, including in test hooks.
 $frame=[Windows.Threading.DispatcherFrame]::new();$settle=[Windows.Threading.DispatcherTimer]::new();$settle.Interval=[TimeSpan]::FromMilliseconds(40);$settle.Add_Tick({$settle.Stop();$frame.Continue=$false});$settle.Start();[Windows.Threading.Dispatcher]::PushFrame($frame);$bunnyWindow.UpdateLayout()
 $bitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new([int]$bunnyWindow.ActualWidth,[int]$bunnyWindow.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32);$bitmap.Render($bunnyWindow);$encoder=[Windows.Media.Imaging.PngBitmapEncoder]::new();$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap));$path=Join-Path $directory ($Name+'.png');$stream=[IO.File]::Create($path);try{$encoder.Save($stream)}finally{$stream.Dispose()};return $path
}
$bunnyPreferencePath = if($PreferencePath) {$PreferencePath} else {throw 'Installed Island requires an explicit preference path; the retired repository path is refused.'}
$bunnyPreferences = @{ size='compact'; position='center'; idle='providers'; glass='medium'; motion='full'; collapse=10; theme='dark'; primary=@('codex','claude','ollama') }
try { if (Test-Path -LiteralPath $bunnyPreferencePath) { $saved=Get-Content -LiteralPath $bunnyPreferencePath -Raw | ConvertFrom-Json; foreach ($property in $saved.PSObject.Properties) { if ($bunnyPreferences.ContainsKey($property.Name)) { $bunnyPreferences[$property.Name]=$property.Value } } } } catch { }
$bunnyView='idle'; $bunnyExpanded=$false; $bunnyTaskExpanded=$false; $bunnyPending=$null; $bunnyFinishedAt=$null; $bunnySeenTaskState=''; $bunnyHeatDismissed=$null; $bunnyHot=$null; $bunnyOnline=$false; $bunnySettingsUpdating=$false
$bunnyAnimate = -not $SmokeTest -and [Windows.SystemParameters]::ClientAreaAnimation -and -not [Windows.SystemParameters]::HighContrast
[xml]$bunnyVisualXaml = @'
<StackPanel xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
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
 <Border x:Name="Glass" Background="{DynamicResource BunnyGlass}" CornerRadius="28" BorderBrush="{DynamicResource BunnySep}" BorderThickness="1" Padding="12,10" Margin="10">
  <Border.Effect><DropShadowEffect BlurRadius="20" ShadowDepth="4" Opacity="0.25"/></Border.Effect>
  <StackPanel>
   <DockPanel Height="44" LastChildFill="True">
    <Button x:Name="ExtrasButton" DockPanel.Dock="Right" Style="{DynamicResource IconButton}" ToolTip="Island menu" AutomationProperties.Name="Island menu"/>
    <Button x:Name="SystemButton" DockPanel.Dock="Right" Width="56" Padding="0" ToolTip="System telemetry" AutomationProperties.Name="System telemetry"><TextBlock x:Name="Temperature" Text="--" FontSize="13" Foreground="{DynamicResource BunnyMuted}"/></Button>
    <Button x:Name="BunnyButton" DockPanel.Dock="Left" Width="44" Padding="0" ToolTip="Ask Bunny" AutomationProperties.Name="Ask Bunny"><Border x:Name="BrandTile" Width="28" Height="28" CornerRadius="8" Background="{DynamicResource BunnyField}"><Path x:Name="BrandMark" Data="M10 17C7 13 7 5 10 5S14 11 14 15H18C18 11 19 5 22 5S25 13 22 17C25 19 25 24 22 26C19 29 13 29 10 26C7 24 7 19 10 17Z M10.8 21 A1.2 1.2 0 1 0 13.2 21 A1.2 1.2 0 1 0 10.8 21 M18.8 21 A1.2 1.2 0 1 0 21.2 21 A1.2 1.2 0 1 0 18.8 21" Fill="{DynamicResource BunnyText}" Width="17" Height="22" Stretch="Uniform" HorizontalAlignment="Center" VerticalAlignment="Center"/></Border></Button>
    <Border DockPanel.Dock="Left" Width="1" Height="20" Background="{DynamicResource BunnySep}" Margin="4,0,10,0"/>
    <StackPanel x:Name="Providers" Orientation="Horizontal" VerticalAlignment="Center"/>
   </DockPanel>
   <Button x:Name="CompactTask" Visibility="Collapsed" Padding="8,8" HorizontalContentAlignment="Stretch" Margin="0,8,0,0" AutomationProperties.Name="Expand active task"><DockPanel><TextBlock x:Name="CompactTime" DockPanel.Dock="Right" Foreground="{DynamicResource BunnyMuted}" VerticalAlignment="Center"/><StackPanel><TextBlock x:Name="CompactTitle" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock x:Name="CompactActivity" FontSize="12" Foreground="{DynamicResource BunnyAccent}" TextTrimming="CharacterEllipsis"/></StackPanel></DockPanel></Button>
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
    <StackPanel x:Name="ComposerPanel" Visibility="Collapsed">
     <TextBlock x:Name="PromptLabel" Text="What do you want Bunny to do?" FontSize="21" FontWeight="SemiBold" Margin="0,0,0,16"/>
     <TextBox x:Name="Prompt" Tag="Describe a task. Bunny will find the right agent." Height="122" MaxLength="16000" AcceptsReturn="True" TextWrapping="Wrap" AutomationProperties.Name="Task description"/>
     <Border Background="{DynamicResource BunnyField}" CornerRadius="14" Padding="4" Margin="0,16,0,12" HorizontalAlignment="Left"><ListBox x:Name="Mode" SelectedIndex="1" Background="Transparent" BorderThickness="0" AutomationProperties.Name="Task depth"><ListBox.ItemsPanel><ItemsPanelTemplate><UniformGrid Rows="1"/></ItemsPanelTemplate></ListBox.ItemsPanel><ListBoxItem Style="{DynamicResource BunnySegmentItem}" Content="Fast"/><ListBoxItem Style="{DynamicResource BunnySegmentItem}" Content="Balanced"/><ListBoxItem Style="{DynamicResource BunnySegmentItem}" Content="Deep"/></ListBox></Border>
     <WrapPanel Margin="0,0,0,12"><StackPanel Margin="0,0,12,0"><TextBlock Text="Project" Foreground="{DynamicResource BunnyMuted}" FontSize="12"/><ComboBox x:Name="ProjectChoice" Width="168" MinHeight="44" AutomationProperties.Name="Task project"/></StackPanel><StackPanel Margin="0,0,12,0"><TextBlock Text="Route" Foreground="{DynamicResource BunnyMuted}" FontSize="12"/><ComboBox x:Name="RouteChoice" Width="106" MinHeight="44" AutomationProperties.Name="Task route"/></StackPanel><CheckBox x:Name="LocalOnly" Content="Local only" Foreground="{DynamicResource BunnyMuted}" MinHeight="44" VerticalContentAlignment="Center" AutomationProperties.Name="Local-only routing"/></WrapPanel>
     <DockPanel><Button x:Name="RouteButton" DockPanel.Dock="Right" Style="{DynamicResource PrimaryButton}"/><TextBlock Text="Ctrl + Enter to route  /  Esc to collapse" Foreground="{DynamicResource BunnyMuted}" FontSize="12" VerticalAlignment="Center"/></DockPanel>
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
 if([Windows.SystemParameters]::HighContrast){$palette.BunnyText=[Windows.SystemColors]::WindowTextColor.ToString();$palette.BunnyMuted=$palette.BunnyText;$palette.BunnyGlass=[Windows.SystemColors]::WindowColor.ToString();$palette.BunnySep=$palette.BunnyText;$palette.BunnyViolet=$palette.BunnyText}
 foreach($key in $palette.Keys){$bunnyWindow.Resources[$key]=New-BunnyBrush $palette[$key]}
 $alpha=switch($bunnyPreferences.glass){'low'{250}'high'{218}default{238}};if([Windows.SystemParameters]::HighContrast){$alpha=255}
 $glass=$bunnyWindow.Resources['BunnyGlass'].Color;$glass.A=[byte]$alpha;$bunnyWindow.Resources['BunnyGlass']=[Windows.Media.SolidColorBrush]::new($glass)
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
function Set-BunnyPosition {
 $area=[Windows.SystemParameters]::WorkArea
 $bunnyWindow.Top=$area.Top+4
 $bunnyWindow.Left=switch($bunnyPreferences.position){'left'{$area.Left+12}'right'{$area.Right-$bunnyWindow.Width-12}default{$area.Left+($area.Width-$bunnyWindow.Width)/2}}
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
function Resize-Bunny {
 $expanded=$bunnyView-ne'idle';$script:bunnyExpanded=$expanded
 $bunnyControls.Details.Visibility=if($expanded){'Visible'}else{'Collapsed'}
 $bunnyControls.DetailsScroll.Visibility=$bunnyControls.Details.Visibility
 $bunnyControls.DetailsScroll.MaxHeight=[Math]::Max(240,[Windows.SystemParameters]::WorkArea.Height-144)
 $width=if($expanded){540}else{switch($bunnyPreferences.size){'compact'{360}'detailed'{420}default{384}}}
 $width=[Math]::Min($width,[Windows.SystemParameters]::WorkArea.Width-24)
 if($script:bunnyTargetWidth-ne$width){$script:bunnyTargetWidth=$width;$from=$bunnyWindow.ActualWidth;$bunnyWindow.BeginAnimation([Windows.Window]::WidthProperty,$null);$bunnyWindow.Width=$width;if($bunnyAnimate-and$from-gt0){$animation=[Windows.Media.Animation.DoubleAnimation]::new($from,$width,[Windows.Duration]::new([TimeSpan]::FromMilliseconds($bunnyMotion.morph)));$animation.FillBehavior='Stop';$animation.EasingFunction=[Windows.Media.Animation.CubicEase]::new();$animation.EasingFunction.EasingMode='EaseOut';$bunnyWindow.BeginAnimation([Windows.Window]::WidthProperty,$animation)}}
 Set-BunnyPosition
 # Flush pending visibility and child changes before measuring the new view.
 # A ScrollViewer otherwise reports the previous viewport until the next dispatcher pass.
 $bunnyWindow.UpdateLayout()
 $bunnyControls.Details.InvalidateMeasure();$bunnyControls.Details.Measure([Windows.Size]::new($width-46,[double]::PositiveInfinity))
 $detailHeight=if($expanded){[Math]::Min($bunnyControls.Details.DesiredSize.Height,$bunnyControls.DetailsScroll.MaxHeight)}else{0}
 $bunnyControls.DetailsScroll.Height=$detailHeight
 $compactHeight=0;if(-not$expanded-and$bunnyControls.CompactTask.Visibility-eq'Visible'){$bunnyControls.CompactTask.Measure([Windows.Size]::new($width-46,[double]::PositiveInfinity));$compactHeight=$bunnyControls.CompactTask.DesiredSize.Height}
 if(-not$expanded-and$bunnyControls.CompactMission.Visibility-eq'Visible'){$bunnyControls.CompactMission.Measure([Windows.Size]::new($width-46,[double]::PositiveInfinity));$compactHeight+=$bunnyControls.CompactMission.DesiredSize.Height}
 if(-not$expanded-and$bunnyControls.CompactAgent.Visibility-eq'Visible'){$bunnyControls.CompactAgent.Measure([Windows.Size]::new($width-46,[double]::PositiveInfinity));$compactHeight+=$bunnyControls.CompactAgent.DesiredSize.Height}
 if(-not$expanded-and$bunnyControls.CompactHealth.Visibility-eq'Visible'){$bunnyControls.CompactHealth.Measure([Windows.Size]::new($width-46,[double]::PositiveInfinity));$compactHeight+=$bunnyControls.CompactHealth.DesiredSize.Height}
 $height=[Math]::Min(86+$detailHeight+$compactHeight,[Windows.SystemParameters]::WorkArea.Height-12)
 Set-BunnyHeight $height
}
function Set-BunnyView([string]$View) {
 $script:bunnyView=$View
 foreach($entry in @{composer='ComposerPanel';routing='RoutingPanel';approval='ApprovalPanel';tasks='TasksPanel';task='TaskPanel';system='SystemPanel';thermal='ThermalPanel';menu='MenuPanel';phone='PhonePanel';settings='SettingsPanel';constellation='ConstellationPanel';voice='NativeVoicePanel'}.GetEnumerator()){if($bunnyControls[$entry.Value]){$bunnyControls[$entry.Value].Visibility=if($entry.Key-eq$View){'Visible'}else{'Collapsed'}}}
 $bunnyControls.CompactTask.Visibility=if($View-eq'idle'-and$bunnySelectedId){'Visible'}else{'Collapsed'}
 $bunnyControls.ExtrasButton.ToolTip=if($View-eq'idle'){'Island menu'}else{'Collapse Island'}
 Set-BunnyButton $bunnyControls.ExtrasButton '' $(if($View-eq'idle'){'ellipsis'}else{'x'}) 17
 Resize-Bunny
 if(Get-Command Update-BunnyMotion -ErrorAction SilentlyContinue){Update-BunnyMotion;Resize-Bunny}
 if($bunnyAnimate-and$View-ne'idle'){$fade=[Windows.Media.Animation.DoubleAnimation]::new(0.5,1,[Windows.Duration]::new([TimeSpan]::FromMilliseconds($bunnyMotion.content)));$bunnyControls.Details.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)}
}
function Close-BunnyDetails { Set-BunnyView 'idle' }
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
 try{$script:bunnySnapshot=Invoke-Bunny;$script:bunnyOnline=$true;$script:bunnyLastError=$null;$bunnyControls.Presence.Text='Host online '+$bunnyDot+' approval before launch';Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyPositive'
  $active=@($bunnySnapshot.tasks|Where-Object state -notin @('completed','failed','stopped'));if(-not$bunnySelectedId-and$active.Count){$script:bunnySelectedId=$active[0].id};Populate-BunnyTasks;Show-BunnyTask
  $sample=@($bunnySnapshot.samples)|Select-Object -Last 1;$temperatures=@();if($sample){if($null-ne$sample.cpu.temperatureC){$temperatures+=$sample.cpu.temperatureC};$temperatures+=@($sample.gpus|Where-Object {$null-ne$_.temperatureC}|ForEach-Object {$_.temperatureC})};$bunnyControls.Temperature.Text=if($temperatures.Count){[string]($temperatures|Measure-Object -Maximum).Maximum+[char]0x00B0}else{'--'}
  $hot=$null;if($sample-and([DateTimeOffset]::Now.ToUnixTimeMilliseconds()-$sample.at)-lt15000){foreach($gpu in $sample.gpus){if($null-ne$gpu.temperatureC-and$gpu.temperatureC-ge$bunnySnapshot.thermal.gpuWarn){$hot=@{name=$gpu.name;temperature=$gpu.temperatureC;key='gpu:'+ $gpu.name};break}};if(-not$hot-and$null-ne$sample.cpu.temperatureC-and$sample.cpu.temperatureC-ge$bunnySnapshot.thermal.cpuWarn){$hot=@{name='CPU';temperature=$sample.cpu.temperatureC;key='cpu'}}};$script:bunnyHot=$hot
  if($hot){$local=@($active|Where-Object {$_.provider-eq'ollama'-and$_.model-and$_.model-notmatch':cloud$'-and$_.state-in@('running','launching','verifying')});$bunnyControls.ThermalName.Text=$hot.name;$bunnyControls.ThermalValue.Text=[string]$hot.temperature+[char]0x00B0+'C';$bunnyControls.ThermalDetail.Text=if($local.Count){'Ollama '+$bunnyDot+' '+$local[0].model+"`nLocal Ollama generation is active"}else{'Above your configured warning threshold.'};$bunnyControls.ThermalStopButton.IsEnabled=$local.Count-eq1;$bunnyControls.ThermalStopButton.Tag=if($local.Count-eq1){$local[0].id}else{$null};if($hot.key-ne$bunnyHeatDismissed-and$bunnyView-notin@('composer','routing')){Set-BunnyView 'thermal'}}else{$script:bunnyHeatDismissed=$null}
  if($bunnyView-eq'system'){Show-BunnySystem};Draw-BunnyProviders;Update-BunnyRouteState
  if($bunnyFinishedAt-and$bunnyPreferences.collapse-gt0-and$bunnyView-eq'task'-and([DateTimeOffset]::Now.ToUnixTimeMilliseconds()-$bunnyFinishedAt)-ge($bunnyPreferences.collapse*1000)){$script:bunnySelectedId=$null;$script:bunnyFinishedAt=$null;Set-BunnyView 'idle'}
  if($bunnyView-eq'idle'-and-not$active.Count-and-not$bunnyFinishedAt){$script:bunnySelectedId=$null;$bunnyControls.CompactTask.Visibility='Collapsed'}elseif($bunnyView-eq'idle'-and$active.Count){$bunnyControls.CompactTask.Visibility='Visible'}
  Update-BunnyPresentation
  Resize-Bunny
  Update-BunnyMotion
 }catch{$script:bunnyOnline=$false;$script:bunnyLastError=$_.Exception.Message;$bunnyControls.Presence.Text='Host unavailable - retained work may be stale';$bunnyControls.CompactHealth.Text='Host unavailable - retained work may be stale';$bunnyControls.CompactHealth.Visibility='Visible';Set-BunnyRef $bunnyControls.PresenceDot ([Windows.Shapes.Shape]::FillProperty) 'BunnyMuted';$bunnyControls.Temperature.Text='--';$bunnyControls.ApproveButton.IsEnabled=$false;$bunnyControls.StopButton.IsEnabled=$false;Update-BunnyAgentPresentation;Resize-Bunny;Update-BunnyRouteState;Draw-BunnyProviders;Update-BunnyMotion}
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
function Apply-BunnyAppearance { $light=if($bunnyPreferences.theme-eq'system'){try{(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize').AppsUseLightTheme-eq1}catch{$false}}else{$bunnyPreferences.theme-eq'light'};Set-BunnyTheme $light;Set-BunnyPosition;if(Get-Command Update-BunnyMotion -ErrorAction SilentlyContinue){$script:bunnyOrbState='';Update-BunnyMotion} }
$bunnySettingsUpdating=$true
. (Join-Path $PSScriptRoot 'Bunny-Island.Motion.ps1')
. (Join-Path $PSScriptRoot 'Bunny-Island.Presentation.ps1')
Add-BunnyChoice $bunnyControls.SizeChoice @(@('compact','Compact'),@('normal','Normal'),@('detailed','Detailed')) 'size'
Add-BunnyChoice $bunnyControls.PositionChoice @(@('left','Top left'),@('center','Top center'),@('right','Top right')) 'position'
Add-BunnyChoice $bunnyControls.IdleChoice @(@('providers','Agents'),@('temperatures','System'),@('tasks','Active tasks'),@('clock','Clock'),@('mixed','Mixed'),@('minimal','Minimal')) 'idle'
Add-BunnyChoice $bunnyControls.GlassChoice @(@('low','Low'),@('medium','Medium'),@('high','High')) 'glass'
Add-BunnyChoice $bunnyControls.CollapseChoice @(@(5,'5 sec'),@(10,'10 sec'),@(30,'30 sec'),@(0,'Never')) 'collapse'
Add-BunnyChoice $bunnyControls.ThemeChoice @(@('system','System'),@('dark','Dark'),@('light','Light')) 'theme'
foreach($id in @('codex','claude','ollama','opencode','cline','cursor')){$check=[Windows.Controls.CheckBox]::new();$check.Content=(Get-Culture).TextInfo.ToTitleCase($id);$check.Tag=$id;Set-BunnyRef $check ([Windows.Controls.Control]::ForegroundProperty) 'BunnyText';$check.Margin='0,0,16,8';$check.MinHeight=44;$check.VerticalContentAlignment='Center';$check.IsChecked=$bunnyPreferences.primary-contains$id;$check.Add_Click({$chosen=@($bunnyControls.PrimaryChoices.Children|Where-Object IsChecked|ForEach-Object {$_.Tag});if($chosen.Count-gt3){$this.IsChecked=$false;return};$bunnyPreferences.primary=$chosen;Save-BunnyPreferences;Draw-BunnyProviders});[void]$bunnyControls.PrimaryChoices.Children.Add($check)}
$bunnySettingsUpdating=$false
Set-BunnyButton $bunnyControls.RouteButton 'Route' 'arrow-right';Set-BunnyButton $bunnyControls.ApproveButton 'Approve & Run' 'play';Set-BunnyButton $bunnyControls.StopButton 'Stop' 'square'
Apply-BunnyAppearance;if($LightView){Set-BunnyTheme $true}
Set-BunnyMotionMode
$bunnyWindow.Add_SizeChanged({Set-BunnyPosition})
$bunnyControls.BunnyButton.Add_Click({if($bunnyHeld){$script:bunnyHeld=$false;return};Set-BunnyView 'composer';$bunnyControls.Prompt.Focus()|Out-Null})
$bunnyControls.CollapseButton.Add_Click({Close-BunnyDetails});$bunnyControls.ExtrasButton.Add_Click({if($bunnyView-eq'idle'){$bunnyControls.OptionalProviders.Text=@($bunnySnapshot.providers|Where-Object extension|ForEach-Object {$_.name+' '+$bunnyDot+' '+$_.availability.Replace('_',' ')})-join"`n";Set-BunnyView 'menu'}else{Close-BunnyDetails}})
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
$bunnyWindow.Add_PreviewKeyDown({if($_.Key-eq'Escape'){Close-BunnyDetails;$_.Handled=$true}elseif($_.Key-eq'Return'-and([Windows.Input.Keyboard]::Modifiers-band[Windows.Input.ModifierKeys]::Control)){if($bunnyView-eq'composer'-and$bunnyControls.RouteButton.IsEnabled){Invoke-BunnyClick $bunnyControls.RouteButton};$_.Handled=$true}elseif($_.Key-in@('Up','Down')-and$bunnyView-in@('idle','task','tasks')){Move-BunnyFocus $(if($_.Key-eq'Down'){1}else{-1});$_.Handled=$true}})
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
