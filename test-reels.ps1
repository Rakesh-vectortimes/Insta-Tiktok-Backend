$urls = @(
  "https://www.instagram.com/reel/DaLGrUHSbbv/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ==",
  "https://www.instagram.com/reel/DaMRFk8B8c9/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ==",
  "https://www.instagram.com/reel/DaLExOmul6b/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ==",
  "https://www.instagram.com/reels/DaK8ACKkl8X/",
  "https://www.instagram.com/reels/DaKvI8OBZ9N/"
)

$successCount = 0
$failCount = 0

foreach ($url in $urls) {
  $body = @{ url = $url } | ConvertTo-Json
  try {
    $result = Invoke-RestMethod -Method POST -Uri "https://insta-tiktok-backend-production.up.railway.app/api/instagram/reel" -ContentType "application/json" -Body $body
    Write-Host "SUCCESS: $url -> $($result.title)" -ForegroundColor Green
    $successCount++
  } catch {
    $err = $_.ErrorDetails.Message
    Write-Host "FAILED: $url -> $err" -ForegroundColor Red
    $failCount++
  }
}

Write-Host ""
Write-Host "--- Summary: $successCount succeeded, $failCount failed out of $($urls.Count) ---" -ForegroundColor Cyan