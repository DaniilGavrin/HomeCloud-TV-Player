# KAN-59: one-shot trusted LAN test controller. Does NOT read media itself.
# Examples:
# .\scripts\Dev-Play-Storage.ps1 -Backend ws://192.0.2.10:8080/ws -StorageNodeId <id>
# .\scripts\Dev-Play-Storage.ps1 -Backend ws://192.0.2.10:8080/ws -StorageNodeId <id> -NodeId <backendNode> -FileId <file_id> -Play
# To switch an active room without ROOM_CONFLICT, add -RoomId <room_id> to -Play.
# -ListRooms prints authoritative active rooms. -Stop -RoomId <id> closes one.
[CmdletBinding()]
param(
    [string]$Backend = 'ws://127.0.0.1:8080/ws',
    [Parameter(Mandatory=$true)][string]$StorageNodeId,
    [string]$RootID = 'storage-hdd',
    [ValidateSet('disk','folder')][string]$RootKind = 'disk',
    [string]$Path = '',
    [string]$NodeId = '',
    [string]$TvDeviceId = '',
    [string]$FileId = '',
    [string]$RoomId = '',
    [ValidateSet('lan','tailscale')][string]$Network = 'lan',
    [switch]$ListRooms,
    [switch]$Stop,
    [switch]$Play
)
$ErrorActionPreference = 'Stop'
$uri = [Uri]::new($Backend)
if ($uri.Scheme -notin @('ws','wss') -or !$uri.Host -or $uri.AbsolutePath -ne '/ws') {
    throw "Backend must be an explicit ws://IP:PORT/ws or wss://IP:PORT/ws"
}
if ([string]::IsNullOrWhiteSpace($StorageNodeId)) { throw 'StorageNodeId required' }
if ($Stop -and $Play) { throw '-Stop and -Play are mutually exclusive.' }
if ($Stop -and [string]::IsNullOrWhiteSpace($RoomId)) { throw '-Stop requires an explicit -RoomId.' }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$timeout = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(20))
$utf8 = [System.Text.Encoding]::UTF8
function Send-Message([object]$payload) {
    $json = ConvertTo-Json -InputObject $payload -Depth 20 -Compress
    $bytes = $utf8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    $socket.SendAsync($segment,[System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,$timeout.Token).GetAwaiter().GetResult() | Out-Null
}
function Receive-Message {
    $buffer = New-Object byte[] 65536
    $stream = [IO.MemoryStream]::new()
    try {
        do {
            $segment = [ArraySegment[byte]]::new($buffer)
            $result = $socket.ReceiveAsync($segment,$timeout.Token).GetAwaiter().GetResult()
            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                throw 'Backend closed WebSocket'
            }
            if ($stream.Length + $result.Count -gt 1048576) { throw 'Unexpectedly large control reply' }
            $stream.Write($buffer,0,$result.Count)
        } while (!$result.EndOfMessage)
        return ($utf8.GetString($stream.ToArray()) | ConvertFrom-Json)
    } finally { $stream.Dispose() }
}
function Invoke-Control([string]$action,[object]$data) {
    $id = 'media-test-' + [Guid]::NewGuid().ToString('N')
    Send-Message @{v=1;id=$id;type='command';action=$action;data=$data}
    for ($i=0; $i -lt 100; $i++) {
        $reply = Receive-Message
        if ($reply.id -ne $id) { continue }
        if ($reply.type -eq 'error') { throw "Backend rejected $action : $($reply.error)" }
        if ($reply.type -ne 'result') { throw "Unexpected response: $($reply.type)" }
        return $reply.data
    }
    throw "No response to $action"
}
try {
    Write-Host "[CONNECT] $Backend"
    $socket.ConnectAsync($uri,$timeout.Token).GetAwaiter().GetResult() | Out-Null
    $clientID = 'hc-tv-smoke-' + [Guid]::NewGuid().ToString('N')
    Send-Message @{v=1;id='media-test-hello';type='hello';device_id=$clientID;client_type='ui'}
    $hello = Receive-Message
    if ($hello.type -ne 'identified' -or $hello.id -ne 'media-test-hello') {
        throw "Backend hello failed: $($hello | ConvertTo-Json -Compress)"
    }
    $clients = @(Invoke-Control 'clients.list' @{})
    $tvs = @($clients | Where-Object { $_.client_type -eq 'tv' })
    Write-Host "[TV DEVICES]"
    $tvs | Select-Object device_id,client_type | Format-Table | Out-Host
    if ($ListRooms) {
        $rooms = @(Invoke-Control 'media.rooms.list' @{})
        Write-Host '[ROOMS]'
        $rooms | Select-Object room_id,playback_id,generation,room_state,playback_state |
            Format-Table -Wrap | Out-Host
        if (-not $Play -and -not $Stop) { return }
    }
    if ($Stop) {
        $closed = Invoke-Control 'media.rooms.stop' @{
            command_id=('dev-stop-' + [Guid]::NewGuid().ToString('N'))
            room_id=$RoomId
        }
        Write-Host '[STOP RESULT]'
        $closed | Format-List | Out-Host
        return
    }
    $files = Invoke-Control 'storage.fs.list' @{
        storage_node_id=$StorageNodeId
        root=@{kind=$RootKind;id=$RootID}
        path=$Path
        limit=100
    }
    Write-Host "[FILES] Root $RootKind/$RootID path '$Path'"
    @($files.items) | Select-Object name,kind,size_bytes,file_id | Format-Table -Wrap | Out-Host
    if (!$Play) {
        Write-Host '[INFO] Listing only. Supply -Play -FileId <file_id> -NodeId <Backend node ID> to send media.rooms.play.'
        return
    }
    if ([string]::IsNullOrWhiteSpace($FileId) -or [string]::IsNullOrWhiteSpace($NodeId)) {
        throw 'To play, specify both -FileId and -NodeId.'
    }
    if (!$TvDeviceId) {
        if ($tvs.Count -ne 1) {
            throw "Expected exactly one connected TV (got $($tvs.Count)); specify -TvDeviceId."
        }
        $TvDeviceId = $tvs[0].device_id
    }
    if (-not ($tvs | Where-Object { $_.device_id -eq $TvDeviceId })) {
        throw "TV '$TvDeviceId' is not online on this Backend."
    }
    $playData = @{
        command_id=('dev-play-' + [Guid]::NewGuid().ToString('N'))
        network=$Network
        target=@{node_id=$NodeId;device_id=$TvDeviceId}
        source=@{storage_node_id=$StorageNodeId;file_id=$FileId}
    }
    if (-not [string]::IsNullOrWhiteSpace($RoomId)) {
        $playData.room_id = $RoomId
    }
    $outcome = Invoke-Control 'media.rooms.play' $playData
    Write-Host '[PLAY RESULT]'
    $outcome | Format-List | Out-Host
    Write-Host '[CHECK] TV should open real HomeCloud player once the Gateway prepares the source and attaches.'
} finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        try { $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,'done',
            [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null } catch {}
    }
    $socket.Dispose()
    $timeout.Dispose()
}
