# Gather

Resource gathering automation game that spans multple planets with realistic orbital mechanics and energy requirements

## Setup

### Prerequisites
- Node.js and npm
- Python 3.x
- Python virtual environment

### Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Set up Python virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate  # On macOS/Linux
# or
.venv\Scripts\activate  # On Windows
```

3. Install Python dependencies (if requirements.txt exists):
```bash
pip install fastapi uvicorn
```

## Launch Instructions

### Frontend (Moon Orbit Simulation)

Start the development server for the main moon orbit simulation:
```bash
npm start
```
The application will be available at `http://localhost:8080`

### Frontend (Mine Gather Game)

Start the development server for the Mine Gather game:
```bash
npm run start:mine
```
The application will be available at `http://localhost:8080`

### Backend Server

Start the Python FastAPI backend server:
```bash
source .venv/bin/activate  # Activate virtual environment first
python backend/server.py
```
The server will run on `http://localhost:8000`

### Build for Production

Build the main application:
```bash
npm run build
```

Build the Mine Gather game:
```bash
npm run build:mine
```
