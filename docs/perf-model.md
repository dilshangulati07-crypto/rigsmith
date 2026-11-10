# Performance model (estimate)

`js/perf.js` gives each build a 0–100 score per workload. It is a **heuristic estimate**, not a benchmark, and the UI must label it "Estimate". 100 means "the strongest parts in the catalogue for this workload", not a frame rate.

All constants are at the top of `js/perf.js`. Change them there and update this page.

## Inputs

| Part | Fields used |
|---|---|
| CPU | `boostClockGHz`, `cores`, `threads`, `architecture`, `name` (X3D), `igpu`, `igpuName` |
| GPU | `chip`, `vramGB`, `chipMaker`, `tier` (fallback only) |
| RAM | `capacityGB`, `modules`, `type`, `speedMTs` |
| Storage | `readMBs` of the fastest drive |

If RAM or storage is missing, the model assumes 16 GB dual-channel and a SATA SSD and lists that under `assumptions`. With no CPU, every score is `null`.

## CPU

- **IPC** per architecture (Zen 3 = 1.00): Zen 4 1.13, Zen 5 1.20, Alder Lake 1.05, Raptor Lake (and Refresh) 1.09, Arrow Lake 1.12. Unknown architectures get 1.00.
- **Single-thread** `ST = boostGHz × IPC / 6.9 × 100`. 6.9 is about the Ryzen 9 9950X.
- **Effective cores**: an SMT core counts 1.3. On Intel 12th–14th gen hybrids, P = threads − cores and E = cores − P, with E-cores at 0.55. Arrow Lake (no Hyper-Threading, P/E split not in the data) counts 0.85 per core.
- **Multi-thread** `MT = effectiveCores × boostGHz × IPC / 142 × 100`. 142 is the Ryzen 9 9950X.
- **Gaming** `= ST × 1.2 if X3D × 0.93 if Arrow Lake × 0.85 if under 6 cores`.

## GPU

`GPU_INDEX` holds relative 1440p raster performance with RTX 4090 = 100, rounded from public review averages (±10%). For example: RTX 5090 127, RX 7900 XTX 81, RX 9070 XT 74, RTX 4070 SUPER 60, RTX 4060 33, RTX 3050 6GB 15. Integrated graphics use the same scale, from Radeon 780M at 9 down to UHD 730 at 2.5. A chip not in the table falls back to its tier: budget 25, mid 45, high 65, flagship 95. The result says when it did that.

## Gaming (1080p, 1440p, 4K)

The CPU and the GPU each get a frame-rate "capacity":

```
cpuCap = cpuGaming × 1.3                 (the same at every resolution)
gpuCap = gpuIndex × resScale × vramFactor
resScale:   1080p 1.55 · 1440p 1.00 · 4K 0.52
vramFactor: 1440p 0.92 if < 10 GB · 4K 0.75 if < 10 GB, 0.85 if < 12 GB
delivered = (cpuCap^-4 + gpuCap^-4)^(-1/4)  (soft minimum: the slower side dominates)
score = delivered × ramFactor / reference × 100
```

`reference` is the same formula for the best pair in the catalogue (Ryzen 7 9800X3D gaming ≈ 108, RTX 5090 = 127) at that resolution. Each resolution is scored against its own reference, so the three scores are not comparable with each other. A CPU-limited build can score higher at 4K than at 1080p.

`ramFactor` = capacity (under 16 GB 0.80, 16–31 GB 0.97, 32 GB+ 1.00) × 0.90 for a single module × 0.98 for slow memory (DDR4 under 3200 or DDR5 under 5600).

## Workstation and general scores

Every component is on a 0–100 scale. The weights in each row add up to 1.

```
GPU    = gpuIndex / 127 × 100
RAM    = log2(GB / 4) / 4 × 100        (16 GB = 50, 32 GB = 75, 64 GB = 100)
Disk   = log10(readMBs / 100) / log10(140) × 100   (HDD ≈ 18, SATA ≈ 35, Gen4 ≈ 86, Gen5 = 100)
VRAM   = vramGB / 32 × 100

Video editing = 0.40 MT + 0.10 ST + 0.20 GPU + 0.15 RAM + 0.15 Disk
AI / compute  = 0.45 (GPU × vendor) + 0.30 VRAM + 0.10 RAM + 0.10 MT + 0.05 Disk
                vendor: NVIDIA 1.0, AMD 0.7, Intel 0.6 (software support); iGPU 0.3
General use   = 0.45 ST + 0.15 MT + 0.20 Disk + 0.20 RAM
```

## Bottleneck hint

The model compares `ratio = cpuCap / gpuCap` at each resolution:

| Condition | Hint |
|---|---|
| ratio < 0.85 at any resolution | CPU limits the GPU at those resolutions. With a top gaming CPU, the hint says this is normal for a flagship card. |
| ratio > 2.5 at 1080p | The GPU is the weak link; the CPU could feed a much faster card. |
| ratio < 1.2 at 1080p | Well matched. |
| otherwise | No CPU bottleneck; the GPU sets the frame rate (the healthy case). |

It also adds hints for under 16 GB of RAM, a single memory module, and a hard drive as the fastest drive.

## Known limits

- Ray tracing, upscaling (DLSS/FSR/XeSS) and frame generation are not modelled.
- The GPU table is raster at 1440p; 4K scaling is one factor for all cards.
- Power limits, cooling and memory timings beyond speed are ignored.
- Price per performance (`js/pricing.js`) divides the reference total by these scores, so it inherits all of the above.
