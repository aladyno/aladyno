param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$TaskName,
  [string]$TaskPath = '\',
  [switch]$All
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-TaskList {
  param([bool]$IncludeAll)

  $tasks = Get-ScheduledTask
  if (-not $IncludeAll) {
    $tasks = $tasks | Where-Object { $_.TaskPath -notlike '\Microsoft\*' }
  }

  $result = foreach ($t in $tasks) {
    $info = $null
    try { $info = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath } catch {}

    $actions = @($t.Actions | ForEach-Object {
        [pscustomobject]@{
          execute          = $_.Execute
          arguments        = $_.Arguments
          workingDirectory = $_.WorkingDirectory
        }
      })

    $triggers = @($t.Triggers | ForEach-Object {
        [pscustomobject]@{
          type               = ($_.CimClass.CimClassName -replace '^MSFT_Task', '' -replace 'Trigger$', '')
          startBoundary      = $_.StartBoundary
          enabled            = $_.Enabled
          daysInterval       = $_.DaysInterval
          weeksInterval      = $_.WeeksInterval
          daysOfWeek         = $_.DaysOfWeek
          repetitionInterval = $_.Repetition.Interval
        }
      })

    [pscustomobject]@{
      name               = $t.TaskName
      path               = $t.TaskPath
      state              = "$($t.State)"
      enabled            = ($t.State -ne 'Disabled')
      description        = $t.Description
      author             = $t.Author
      actions            = $actions
      triggers           = $triggers
      lastRunTime        = if ($info) { if ($info.LastRunTime) { $info.LastRunTime.ToString('o') } else { $null } } else { $null }
      nextRunTime        = if ($info) { if ($info.NextRunTime) { $info.NextRunTime.ToString('o') } else { $null } } else { $null }
      lastResult         = if ($info) { $info.LastTaskResult } else { $null }
      numberOfMissedRuns = if ($info) { $info.NumberOfMissedRuns } else { $null }
    }
  }

  return ,@($result)
}

try {
  switch ($Action) {
    'list' {
      $data = Get-TaskList -IncludeAll:$All.IsPresent
      $payload = [pscustomobject]@{ ok = $true; tasks = $data }
      $payload | ConvertTo-Json -Depth 8 -Compress
    }
    'enable' {
      Enable-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath | Out-Null
      '{"ok":true}'
    }
    'disable' {
      Disable-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath | Out-Null
      '{"ok":true}'
    }
    'run' {
      Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath | Out-Null
      '{"ok":true}'
    }
    'stop' {
      Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath | Out-Null
      '{"ok":true}'
    }
    default {
      throw "Unknown action: $Action"
    }
  }
}
catch {
  $err = $_.Exception.Message -replace '"', "'"
  "{""ok"":false,""error"":""$err""}"
}
