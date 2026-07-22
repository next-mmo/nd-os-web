[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$CrispAsrRoot,

    [string]$BuildDir,

    [ValidateRange(1, 256)]
    [int]$Jobs = 4,

    [switch]$AllowDifferentCommit,

    [switch]$SkipConfigure,

    [switch]$SyncOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$overlayRoot = Join-Path $repositoryRoot 'native\crispasr'
$expectedCommit = (Get-Content -LiteralPath (Join-Path $overlayRoot 'UPSTREAM_COMMIT.txt') -Raw).Trim()
$sourceRoot = (Resolve-Path -LiteralPath $CrispAsrRoot).Path

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '.git'))) {
    throw "CrispAsrRoot is not a Git checkout: $sourceRoot"
}

$currentCommit = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to read the CrispASR Git revision.'
}

if (($currentCommit -ne $expectedCommit) -and (-not $AllowDifferentCommit)) {
    throw "Expected CrispASR commit $expectedCommit, but found $currentCommit. Use -AllowDifferentCommit only for an intentional port."
}

$overlayFiles = @(
    'src\CMakeLists.txt',
    'src\voxcpm2_tts.cpp',
    'src\voxcpm2_tts.h',
    'src\voxcpm2_vae.h',
    'src\crispasr_c_api.cpp',
    'src\core\attention.h',
    'src\core\gpu_backend_pref.h',
    'src\core\conv.h',
    'src\core\ffn.h',
    'src\core\gguf_loader.h',
    'src\core\gguf_loader.cpp',
    'src\core\torch_rng.h',
    'src\core\crispasr_env.h',
    'bindings\javascript\CMakeLists.txt',
    'bindings\javascript\emscripten.cpp',
    'ggml\include\ggml-webgpu.h'
)

foreach ($relativePath in $overlayFiles) {
    $sourcePath = Join-Path $overlayRoot $relativePath
    $destinationPath = Join-Path $sourceRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

$webGpuOverlayRoot = Join-Path $overlayRoot 'ggml\src\ggml-webgpu'
foreach ($file in Get-ChildItem -LiteralPath $webGpuOverlayRoot -File -Recurse) {
    $relativePath = $file.FullName.Substring($webGpuOverlayRoot.Length).TrimStart('\', '/')
    $destinationPath = Join-Path (Join-Path $sourceRoot 'ggml\src\ggml-webgpu') $relativePath
    $destinationDirectory = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destinationPath -Force
}

if ($SyncOnly) {
    Write-Host "CrispASR WebGPU source overlay copied to $sourceRoot"
    return
}

if ([string]::IsNullOrWhiteSpace($BuildDir)) {
    $BuildDir = Join-Path $sourceRoot 'build-webgpu'
} else {
    $BuildDir = [System.IO.Path]::GetFullPath($BuildDir)
}

if (-not $SkipConfigure) {
    $emcmake = Get-Command emcmake -ErrorAction SilentlyContinue
    if ($null -eq $emcmake) {
        throw 'emcmake was not found. Activate the Emscripten SDK environment before running this script.'
    }

    & $emcmake.Source cmake `
        -S $sourceRoot `
        -B $BuildDir `
        -G Ninja `
        '-DCMAKE_BUILD_TYPE=Release' `
        '-DGGML_WEBGPU=ON' `
        '-DGGML_WEBGPU_JSPI=ON' `
        '-DCRISPASR_WASM_SINGLE_FILE=OFF' `
        '-DGGML_OPENMP=OFF' `
        '-DCMAKE_DISABLE_FIND_PACKAGE_OpenMP=TRUE'

    if ($LASTEXITCODE -ne 0) {
        throw 'CMake configuration failed.'
    }
} elseif (-not (Test-Path -LiteralPath (Join-Path $BuildDir 'CMakeCache.txt'))) {
    throw "-SkipConfigure was used, but no configured build exists at $BuildDir"
}

& cmake --build $BuildDir --target libwhisper --parallel $Jobs
if ($LASTEXITCODE -ne 0) {
    throw 'CrispASR WebGPU build failed.'
}

$artifactDirectory = Join-Path $BuildDir 'bin'
$publicDirectory = Join-Path $repositoryRoot 'public\crispasr'
$artifacts = @('libwhisper.js', 'libwhisper.wasm')
New-Item -ItemType Directory -Path $publicDirectory -Force | Out-Null

foreach ($artifact in $artifacts) {
    $sourceArtifact = Join-Path $artifactDirectory $artifact
    if (-not (Test-Path -LiteralPath $sourceArtifact)) {
        throw "Expected build artifact was not produced: $sourceArtifact"
    }

    $destinationArtifact = Join-Path $publicDirectory $artifact
    Copy-Item -LiteralPath $sourceArtifact -Destination $destinationArtifact -Force
    $hash = (Get-FileHash -LiteralPath $destinationArtifact -Algorithm SHA256).Hash
    Write-Host "$artifact  SHA256=$hash"
}

Write-Host "CrispASR WebGPU artifacts copied to $publicDirectory"
