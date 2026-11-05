# KAN-74 TEMPORARY: Send one test-only TV player opening command via Backend clients.send.
# Run from Windows PowerShell with the TV already connected to HomeCloudBackend.
param(
    [string]$Backend = 'ws://100.114.58.74:8080/ws',
    [string]$TvDeviceId = '',
    [string]$Title = 'Проверка открытия плеера',
    [ValidateSet('video', 'audio')][string]$MediaKind = 'video'
)

$ErrorActionPreference = 'Stop'
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$token = [Threading.CancellationToken]::None
$clientId = 'tv-dev-cli-' + [Guid]::NewGuid().ToString('N')

function Send-HC([hashtable]$message) {
    $json = ConvertTo-Json -InputObject $message -Depth 12 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    $ws.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, $token).GetAwaiter().GetResult()
}

function Read-HC([string]$expectedId) {
    $buffer = [IO.MemoryStream]::new()
    $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(12))
    try {
        while ($true) {
            $buffer.SetLength(0)
            do {
                $chunk = New-Object byte[] 16384
                $segment = [ArraySegment[byte]]::new($chunk)
                $result = $ws.ReceiveAsync($segment, $timeout.Token).GetAwaiter().GetResult()
                if ($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                    throw 'Backend closed the WebSocket connection'
                }
                if ($result.MessageType -ne [Net.WebSockets.WebSocketMessageType]::Text) {
                    throw 'Expected a JSON text message'
                }
                $buffer.Write($chunk, 0, $result.Count)
                if ($buffer.Length -gt 1048576) { throw 'Backend message exceeds 1 MiB' }
            } until ($result.EndOfMessage)
            $reply = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($buffer.ToArray()))
            if ($reply.type -eq 'event') { continue }
            if ($reply.id -ne $expectedId) {
                throw "Unexpected reply id '$($reply.id)' (expected '$expectedId')"
            }
            if ($reply.type -eq 'error') { throw "Backend rejected command: $($reply.error)" }
            return $reply
        }
    } finally {
        $buffer.Dispose()
        $timeout.Dispose()
    }
}

try {
    Write-Host "[CONNECT] $Backend"
    $connectTimeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(10))
    try { $ws.ConnectAsync([Uri]$Backend, $connectTimeout.Token).GetAwaiter().GetResult() }
    finally { $connectTimeout.Dispose() }

    Send-HC @{ v = 1; id = 'dev-hello'; type = 'hello'; device_id = $clientId; client_type = 'cli' }
    $hello = Read-HC 'dev-hello'
    if ($hello.type -ne 'identified') { throw "Unexpected hello response: $($hello.type)" }

    Send-HC @{ v = 1; id = 'dev-list'; type = 'command'; action = 'clients.list'; data = @{} }
    $list = Read-HC 'dev-list'
    if ($list.type -ne 'result') { throw 'clients.list did not return a result' }
    $tvs = @($list.data | Where-Object { $_.client_type -eq 'tv' })
    if ($TvDeviceId) {
        $tvs = @($tvs | Where-Object { $_.device_id -eq $TvDeviceId })
    }
    if ($tvs.Count -ne 1) {
        $all = (@($list.data | Where-Object { $_.client_type -eq 'tv' }) | ForEach-Object { $_.device_id }) -join ', '
        throw "Expected exactly one target TV (found $($tvs.Count)). Connected TV IDs: $all. Use -TvDeviceId if needed."
    }
    $target = [string]$tvs[0].device_id
    Write-Host "[TV] $target"

    Send-HC @{
        v = 1
        id = 'dev-open'
        type = 'command'
        action = 'clients.send'
        data = @{
            target = $target
            payload = @{ kind = 'dev.tv.player.open'; title = $Title; media_kind = $MediaKind }
        }
    }
    $reply = Read-HC 'dev-open'
    if ($reply.type -ne 'result' -or $reply.data.status -ne 'queued') {
        throw "Unexpected clients.send response: $($reply.type)"
    }
    Write-Host '[PASS] Test open event queued to TV.'
    Write-Host "Check the TV screen: it should show the fullscreen TEST MODE $MediaKind player."
    Write-Host 'Note: queued is not a playback or screen-render acknowledgment.'
} finally {
    $ws.Dispose()
}
