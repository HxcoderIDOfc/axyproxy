export const config = {
  runtime: 'edge',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, x-api-key',
};

export default function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    "object": "list",
    "data": [
      {
        "id": "Axynity-M1",
        "name": "Axynity Flash M1",
        "object": "model",
        "created": 1700000000,
        "owned_by": "Axynera",
        "origin": "Indonesia",
        "capabilities": {
          "chat": true,
          "vision": true,
          "tools": true
        }
      },
      {
        "id": "Axynity-Xcode",
        "name": "Axynity Xcode Pro",
        "object": "model",
        "created": 1700000000,
        "owned_by": "Axynera",
        "origin": "Indonesia",
        "capabilities": {
          "chat": true,
          "coding": true,
          "tools": true
        }
      },
      {
        "id": "Axynity-Image",
        "name": "Axynity FLUX Vision Image",
        "object": "model",
        "created": 1700000000,
        "owned_by": "Axynera",
        "origin": "Indonesia",
        "capabilities": {
          "image_generation": true
        }
      },
      {
        "id": "Axynity-Audio",
        "name": "Axynity Voice & Speech AI",
        "object": "model",
        "created": 1700000000,
        "owned_by": "Axynera",
        "origin": "Indonesia",
        "capabilities": {
          "speech_to_text": true,
          "text_to_speech": true
        }
      }
    ]
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
