import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

class MockLLMHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
            
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            req_body = json.loads(post_data)
        except json.JSONDecodeError:
            req_body = {}
            
        # If pydantic-ai requests structured output, it might specify response_format or tools
        is_json_request = "response_format" in req_body or "tools" in req_body
        javascript_code = "```javascript\nconsole.log('mock response');\n```"
        mock_content = '{"output": "mock output", "have_enough_information": true}' if is_json_request else javascript_code

        response_body = {
            "id": "chatcmpl-mock123",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req_body.get("model", "mock-model"),
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": mock_content
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 10,
                "total_tokens": 20
            }
        }
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_body).encode('utf-8'))

def run_server(port=8080):
    server_address = ('', port)
    httpd = HTTPServer(server_address, MockLLMHandler)
    print(f"Starting mock LLM server on port {port}...")
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
