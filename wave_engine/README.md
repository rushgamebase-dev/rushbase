# Wave Engine — Beach Wave Detection (Prototype)

Experimental wave/tide detection system for live beach cameras. Uses computer vision to detect ocean wave patterns crossing virtual threshold zones. Unlike the main Rush oracle (which uses YOLO), the Wave Engine uses OpenCV color analysis — no GPU required.

## Concept: Territory Invasion

The ocean "invades" the beach by crossing threshold zones. The system tracks:

- Wave momentum and state
- Zone breach events
- Pressure meter (how close waves are to crossing)
- Streak counting

## Features

- OpenCV-based water detection (color thresholding)
- MJPEG live output for real-time viewing
- Audio alerts on wave events
- YouTube stream support (via yt-dlp)
- ROI masking for detection zones

## Requirements

- Python 3.10+
- OpenCV
- PyAV
- yt-dlp

## Quick Start

```bash
pip install opencv-python av numpy
python3 wave_detector.py
```

## Status

Prototype stage. Currently configured for Maldives beach camera. Not yet integrated with on-chain markets.

## Future

- Integration with Rush prediction markets (bet on wave patterns)
- Multiple beach cameras worldwide
- Tide prediction models
