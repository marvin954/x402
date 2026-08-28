#!/bin/bash

echo "Testing trading API endpoints..."

# Start the server in the background
echo "Starting server..."
cd /home/mammba/Documents/GitHub/x402
PORT=3001 DATABASE_URL=postgres://x402admin:changeme_in_prod@localhost:5432/x402marketplace node src/index.js &
SERVER_PID=$!

# Give the server time to start
echo "Waiting for server to start..."
sleep 5

# Test the /prices endpoint
echo "Testing /prices endpoint..."
PRICES_RESPONSE=$(curl -s http://localhost:3001/trading/prices)
echo "Response: $PRICES_RESPONSE"

# Check if we got valid JSON with prices
if echo "$PRICES_RESPONSE" | grep -q '"prices"'; then
  echo "✓ /prices endpoint working"
else
  echo "✗ /prices endpoint failed"
fi

# Test the /trade endpoint (should return 402 Payment Required since we're not sending payment)
echo "Testing /trade endpoint..."
TRADE_RESPONSE=$(curl -s -w "%{http_code}" -X POST http://localhost:3001/trading/trade \
  -H "Content-Type: application/json" \
  -d '{"pair":"USDC/ETH","side":"buy","amount":100}')
HTTP_CODE=${TRADE_RESPONSE: -3}
TRADE_BODY=${TRADE_RESPONSE:0:-3}

echo "HTTP Code: $HTTP_CODE"
echo "Response: $TRADE_BODY"

if [ "$HTTP_CODE" = "402" ]; then
  echo "✓ /trade endpoint correctly returning 402 Payment Required"
else
  echo "✗ /trade endpoint expected 402, got $HTTP_CODE"
fi

# Test the /trade/{id}/complete endpoint
echo "Testing /trade/complete endpoint..."
COMPLETE_RESPONSE=$(curl -s "http://localhost:3001/trading/trade/test123/complete?tx_hash=0x1234567890abcdef")
echo "Response: $COMPLETE_RESPONSE"

if echo "$COMPLETE_RESPONSE" | grep -q '"confirmed": true'; then
  echo "✓ /trade/complete endpoint working"
else
  echo "✗ /trade/complete endpoint failed"
fi

# Stop the server
echo "Stopping server..."
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null

echo "Testing complete!"
