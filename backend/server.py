from fastapi import FastAPI, WebSocket
import uvicorn

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        print(f"Received from Godot: {data}")
        try:
            num = float(data)
            result = num * num
            await websocket.send_text(str(result))
        except ValueError:
            await websocket.send_text("Invalid number")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

