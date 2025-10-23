#!/usr/bin/env python3
"""
Простой прокси-сервер для обхода CORS при разработке
Перенаправляет запросы к /token на voice.eblusha.org
"""

import http.server
import socketserver
import os
import urllib.request
import urllib.parse
import json
from urllib.error import HTTPError, URLError

class CORSProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Если запрос к /token - проксируем на voice.eblusha.org
        if self.path.startswith('/token'):
            self.proxy_token_request()
        else:
            # Обычная обработка статических файлов
            super().do_GET()
    
    def proxy_token_request(self):
        try:
            # Парсим параметры запроса
            parsed_url = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            
            # Формируем URL для проксирования
            proxy_url = f"https://voice.eblusha.org{self.path}"
            
            # Делаем запрос к реальному серверу
            req = urllib.request.Request(proxy_url)
            req.add_header('User-Agent', 'Eblusha-Proxy/1.0')
            
            with urllib.request.urlopen(req) as response:
                data = response.read()
                
                # Отправляем ответ с CORS заголовками
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()
                self.wfile.write(data)
                
        except HTTPError as e:
            self.send_error(e.code, f"Proxy error: {e.reason}")
        except URLError as e:
            self.send_error(502, f"Proxy connection error: {e.reason}")
        except Exception as e:
            self.send_error(500, f"Proxy internal error: {str(e)}")
    
    def do_OPTIONS(self):
        # Обработка preflight запросов
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def run_proxy_server(port=8080):
    """Запуск прокси-сервера"""
    # Гарантируем, что корень статики — папка рядом с этим файлом
    web_root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_root)

    with socketserver.TCPServer(("", port), CORSProxyHandler) as httpd:
        print(f"🚀 Прокси-сервер запущен на http://localhost:{port}")
        print(f"📡 Проксирует /token запросы на https://voice.eblusha.org")
        print(f"🌐 CORS заголовки включены")
        print(f"⏹️  Для остановки нажмите Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Сервер остановлен")

if __name__ == "__main__":
    run_proxy_server()
