# DOM Lab · Centrifugal Governor Workbench

Interactive Dynamics of Machinery (DOM) virtual laboratory and simulation workbench for **Watt**, **Porter**, **Proell**, and **Hartnell** governors.

## Features
- **3D Virtual Twin (Three.js)**: Real-time physics-driven 3D assembly, orbital camera presets (`ISO`, `FRONT`, `TOP`), spring-damped motion, Variac speed slider, Auto Ramp, and centrifugal force vectors.
- **2D Technical Schematic**: Synchronized HiDPI blueprint force diagrams and governing equations.
- **Characteristic Curves (Chart.js)**: Interactive curves (Height, Radius, Centrifugal Force, Spring Force, Controlling Force with isochronous reference line, Spring Stiffness) overlaid with manual Variac recordings.
- **Python Matplotlib 3D Engine (`simulate_3d.py`)**: Server-side 3D snapshots, multi-speed comparisons, and animated 3D GIF exports.
- **Lab Manual Preset & CSV Export**: One-click Hartnell lab manual dataset (`pg. 65–66`), sequential Variac observation log, and CSV download.

## Run Locally
```bash
pip install -r requirements.txt
python app.py
```
Then open `http://localhost:8080`.

## Deploy on Web (Render / Railway)
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python app.py`
- Reads `PORT` automatically from the environment and binds `0.0.0.0`.
