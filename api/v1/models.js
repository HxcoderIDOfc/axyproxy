export const config = {
  runtime: 'edge',
};

export default function handler(req) {
  return new Response(JSON.stringify({
    "object": "list",
    "data": [
      {
        "id": "Axynity-M1",
        "name": "Axynity flash",
        "object": "model",
        "created": 1700000000,
        "owned_by": "Axynera",
        "origin": "Indonesia"
      },
      {
        "id": "Axynity-Xcode",
        "name": "Axynity Xcode",
        "object": "model",
        "created": 1700000000,
        "owned_by": "Axynera",
        "origin": "Indonesia"
      }
    ]
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
