#!/bin/bash
set -e

echo "🚀 Testing Excalidraw Studio Full Stack..."
echo ""

# Check if backend binary exists
if [ ! -f backend/excalidraw-studio-backend ]; then
    echo "Building backend..."
    cd backend && go build -o excalidraw-studio-backend && cd ..
fi

# Check if frontend is built
if [ ! -d frontend/dist ]; then
    echo "Building frontend..."
    cd frontend && npm run build && cd ..
fi

echo "✅ Build artifacts ready"
echo ""

# Start backend in background
echo "Starting backend on port 8092..."
cd backend
./excalidraw-studio-backend serve --http=127.0.0.1:8092 > /tmp/excalidraw-backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Test health endpoint
echo "Testing /api/health..."
HEALTH=$(curl -s http://127.0.0.1:8092/api/health)
echo "Response: $HEALTH"
echo ""

# Test frontend is served
echo "Testing frontend root..."
curl -s http://127.0.0.1:8092/ > /dev/null && echo "✅ Frontend accessible"
echo ""

# Stop backend
echo "Stopping backend..."
kill $BACKEND_PID 2>/dev/null || true

echo ""
echo "🎉 Full stack test completed!"
echo ""
echo "To run manually:"
echo "  Backend:  cd backend && ./excalidraw-studio-backend serve"
echo "  Frontend: Open http://127.0.0.1:8092"
