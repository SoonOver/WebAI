#!/usr/bin/env python3
"""Generate app icon assets using pure Python (optimized with bytearray)."""
import struct
import zlib
import os
import sys

def make_png_fast(width, height, bg_color, fg_color=None, shape='rect'):
    """Create PNG with optional centered shape. All pixel data built as bytearray."""
    r, g, b = bg_color
    
    # Create pixel rows as flat bytearray
    row_size = width * 3 + 1  # filter byte + RGB
    raw_size = row_size * height
    raw = bytearray(raw_size)
    
    cx, cy = width // 2, height // 2
    icon_r = min(width, height) * 0.35
    
    for y in range(height):
        offset = y * row_size + 1  # skip filter byte
        for x in range(width):
            if fg_color and shape != 'rect':
                if shape == 'circle':
                    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                    in_shape = d < icon_r
                else:
                    in_shape = False
                
                if in_shape:
                    fr, fg, fb = fg_color
                    dc = d / icon_r
                    raw[offset + x*3] = max(0, min(255, int(fr * (1 - dc * 0.2))))
                    raw[offset + x*3 + 1] = max(0, min(255, int(fg * (1 - dc * 0.2))))
                    raw[offset + x*3 + 2] = max(0, min(255, int(fb * (1 - dc * 0.2))))
                else:
                    raw[offset + x*3] = r
                    raw[offset + x*3 + 1] = g
                    raw[offset + x*3 + 2] = b
            else:
                raw[offset + x*3] = r
                raw[offset + x*3 + 1] = g
                raw[offset + x*3 + 2] = b
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(bytes(raw)))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def make_adaptive_png(width, height):
    """PNG with alpha for adaptive icon foreground."""
    row_size = width * 4 + 1
    raw_size = row_size * height
    raw = bytearray(raw_size)
    
    cx, cy = width // 2, height // 2
    icon_r = width * 0.38
    
    for y in range(height):
        offset = y * row_size + 1
        for x in range(width):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d < icon_r:
                dc = d / icon_r
                raw[offset + x*4] = max(0, min(255, int(59 * (1 - dc * 0.3))))
                raw[offset + x*4 + 1] = max(0, min(255, int(130 * (1 - dc * 0.3))))
                raw[offset + x*4 + 2] = max(0, min(255, int(246 * (1 - dc * 0.3))))
                raw[offset + x*4 + 3] = 255
            else:
                raw[offset + x*4 + 3] = 0
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(bytes(raw)))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def make_splash_png(width, height):
    """Dark splash with centered small icon."""
    row_size = width * 3 + 1
    raw_size = row_size * height
    raw = bytearray(raw_size)
    
    bg_r, bg_g, bg_b = 11, 17, 32
    cx, cy = width // 2, height // 2
    icon_r = min(width, height) * 0.10
    
    for y in range(height):
        offset = y * row_size + 1
        dy = y - cy
        row = bytearray(width * 3)
        
        for x in range(width):
            dx = x - cx
            d = (dx*dx + dy*dy) ** 0.5
            if d < icon_r:
                dc = d / icon_r
                row[x*3] = max(0, min(255, int(59 * (1 - dc * 0.2))))
                row[x*3 + 1] = max(0, min(255, int(130 * (1 - dc * 0.2))))
                row[x*3 + 2] = max(0, min(255, int(246 * (1 - dc * 0.2))))
            else:
                row[x*3] = bg_r
                row[x*3 + 1] = bg_g
                row[x*3 + 2] = bg_b
        
        raw[offset:offset + width*3] = row
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(bytes(raw)))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


if __name__ == '__main__':
    assets_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
    
    print("Generating icon.png (1024x1024)...", flush=True)
    icon_data = make_png_fast(1024, 1024, (11, 17, 32), (59, 130, 246), 'circle')
    with open(os.path.join(assets_dir, 'icon.png'), 'wb') as f:
        f.write(icon_data)
    print(f"  icon.png: {len(icon_data)} bytes")
    
    print("Generating adaptive-icon.png (1024x1024 alpha)...", flush=True)
    adaptive_data = make_adaptive_png(1024, 1024)
    with open(os.path.join(assets_dir, 'adaptive-icon.png'), 'wb') as f:
        f.write(adaptive_data)
    print(f"  adaptive-icon.png: {len(adaptive_data)} bytes")
    
    print("Generating splash-icon.png (1284x2778)...", flush=True)
    splash_data = make_splash_png(1284, 2778)
    with open(os.path.join(assets_dir, 'splash-icon.png'), 'wb') as f:
        f.write(splash_data)
    print(f"  splash-icon.png: {len(splash_data)} bytes")
    
    print("Generating favicon.png (48x48)...", flush=True)
    favicon_data = make_png_fast(48, 48, (11, 17, 32), (59, 130, 246), 'circle')
    with open(os.path.join(assets_dir, 'favicon.png'), 'wb') as f:
        f.write(favicon_data)
    print(f"  favicon.png: {len(favicon_data)} bytes")
    
    print("\n✅ Semua assets berhasil dibuat!")
