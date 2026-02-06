// ============================================================================
// WASM Module Reference
// ============================================================================

/** @type {WebAssembly.WebAssemblyInstantiatedSource | null} */
let wasm = null;

// ============================================================================
// File Preloading System
// ============================================================================

/**
 * Preloaded files storage
 * Maps file path to Uint8Array of file contents
 * @type {Map<string, Uint8Array>}
 */
let preloadedFiles = new Map();

/**
 * Files to preload on initialization
 * Add file paths relative to the HTML page location
 * @type {string[]}
 */
const filesToPreload = [
    'public/font.ttf',
    // Add more files here as needed
];

/**
 * Preloads files from the server into memory
 * @returns {Promise<void>}
 */
async function preloadFiles() {
    console.log(`Preloading ${filesToPreload.length} files...`);
    
    const promises = filesToPreload.map(async (filepath) => {
        try {
            const response = await fetch(filepath);
            if (!response.ok) {
                console.warn(`Failed to load file: ${filepath} (${response.status})`);
                return;
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            preloadedFiles.set(filepath, uint8Array);
            console.log(`Loaded: ${filepath} (${uint8Array.length} bytes)`);
        } catch (error) {
            console.error(`Error loading file ${filepath}:`, error);
        }
    });
    
    await Promise.all(promises);
    console.log(`Preloading complete. ${preloadedFiles.size} files loaded.`);
}

/**
 * Gets a preloaded file by path
 * Called from WASM via js_get_file
 * @param {number} path_ptr - Pointer to path string in WASM memory
 * @param {number} path_len - Length of path string
 * @returns {Uint8Array | null} File data or null if not found
 */
function js_get_preloaded_file(path_ptr, path_len) {
    const buffer = wasm.instance.exports.memory.buffer;
    const path = cstr_by_ptr(buffer, path_ptr, path_len);
    
    const fileData = preloadedFiles.get(path);
    if (!fileData) {
        console.warn(`File not found in preloaded files: ${path}`);
        return null;
    }
    
    return fileData;
}

/**
 * Writes file data to WASM memory
 * Called from WASM to copy file contents into WASM heap
 * @param {number} path_ptr - Pointer to path string in WASM memory
 * @param {number} path_len - Length of path string
 * @param {number} dest_ptr - Destination pointer in WASM memory
 * @param {number} max_size - Maximum bytes to copy
 * @returns {number} Actual number of bytes copied, or 0 if file not found
 */
function js_copy_file_to_wasm(path_ptr, path_len, dest_ptr, max_size) {
    const fileData = js_get_preloaded_file(path_ptr, path_len);
    if (!fileData) {
        return 0;
    }
    
    const buffer = wasm.instance.exports.memory.buffer;
    const bytesToCopy = Math.min(fileData.length, max_size);
    const destArray = new Uint8Array(buffer, dest_ptr, bytesToCopy);
    
    destArray.set(fileData.subarray(0, bytesToCopy));
    
    return bytesToCopy;
}

/**
 * Gets the size of a preloaded file
 * @param {number} path_ptr - Pointer to path string in WASM memory
 * @param {number} path_len - Length of path string
 * @returns {number} File size in bytes, or 0 if not found
 */
function js_get_file_size(path_ptr, path_len) {
    const fileData = js_get_preloaded_file(path_ptr, path_len);
    return fileData ? fileData.length : 0;
}

// ============================================================================
// Event System
// ============================================================================

/**
 * OS_Window_Event_Type enum matching os.h
 * @readonly
 * @enum {number}
 */
const OS_Window_Event_Type = {
    NIL: 0,
    CLOSE: 1,
    RESIZE: 2,
    KEYBOARD: 3,
    MOUSE_BUTTON: 4,
    MOUSE_MOVE: 5,
    MOUSE_SCROLL: 6,
};

/**
 * OS_Key enum values matching os.h
 * @readonly
 * @enum {number}
 */
const OS_Key = {
    UNKNOWN: 0,
    MOUSE_L: 1,
    MOUSE_M: 2,
    MOUSE_R: 3,
    
    // Numbers
    KEY_0: 48, KEY_1: 49, KEY_2: 50, KEY_3: 51, KEY_4: 52,
    KEY_5: 53, KEY_6: 54, KEY_7: 55, KEY_8: 56, KEY_9: 57,
    
    // Letters (lowercase)
    KEY_A: 97, KEY_B: 98, KEY_C: 99, KEY_D: 100, KEY_E: 101,
    KEY_F: 102, KEY_G: 103, KEY_H: 104, KEY_I: 105, KEY_J: 106,
    KEY_K: 107, KEY_L: 108, KEY_M: 109, KEY_N: 110, KEY_O: 111,
    KEY_P: 112, KEY_Q: 113, KEY_R: 114, KEY_S: 115, KEY_T: 116,
    KEY_U: 117, KEY_V: 118, KEY_W: 119, KEY_X: 120, KEY_Y: 121,
    KEY_Z: 122,
    
    // Special keys
    LCONTROL: 256,
    RCONTROL: 257,
    LSHIFT: 258,
    RSHIFT: 259,
    LALT: 260,
    RALT: 261,
    META: 262,
    TAB: 263,
    CAPS: 264,
    BACKSPACE: 265,
    DELETE: 266,
    RETURN: 267,
    ESCAPE: 268,
    SPACE: 269,
    
    // Arrow keys
    UP: 270,
    RIGHT: 271,
    DOWN: 272,
    LEFT: 273,
    
    HOME: 274,
    END: 275,
    
    // Function keys
    F1: 276, F2: 277, F3: 278, F4: 279, F5: 280, F6: 281,
    F7: 282, F8: 283, F9: 284, F10: 285, F11: 286, F12: 287,
};

/**
 * Event queue storing events for the current frame
 * @type {Array<{type: number, x: number, y: number, pressed: number, key: number}>}
 */
let eventQueue = [];

/**
 * Current mouse position
 * @type {{x: number, y: number}}
 */
let mousePos = { x: 0, y: 0 };

/**
 * Maps JavaScript key codes to OS_Key enum values
 * @param {KeyboardEvent} event - The keyboard event
 * @returns {number} OS_Key enum value
 */
function mapKeyToOSKey(event) {
    const key = event.key;
    const code = event.code;
    
    // Numbers
    if (key >= '0' && key <= '9') {
        return key.charCodeAt(0);
    }
    
    // Letters (convert to lowercase)
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
        return key.toLowerCase().charCodeAt(0);
    }
    if (key.length === 1 && key >= 'a' && key <= 'z') {
        return key.charCodeAt(0);
    }
    
    // Special keys
    switch (key) {
        case 'Control':
            return event.location === 1 ? OS_Key.LCONTROL : OS_Key.RCONTROL;
        case 'Shift':
            return event.location === 1 ? OS_Key.LSHIFT : OS_Key.RSHIFT;
        case 'Alt':
            return event.location === 1 ? OS_Key.LALT : OS_Key.RALT;
        case 'Meta':
            return OS_Key.META;
        case 'Tab':
            return OS_Key.TAB;
        case 'CapsLock':
            return OS_Key.CAPS;
        case 'Backspace':
            return OS_Key.BACKSPACE;
        case 'Delete':
            return OS_Key.DELETE;
        case 'Enter':
            return OS_Key.RETURN;
        case 'Escape':
            return OS_Key.ESCAPE;
        case ' ':
            return OS_Key.SPACE;
        case 'ArrowUp':
            return OS_Key.UP;
        case 'ArrowRight':
            return OS_Key.RIGHT;
        case 'ArrowDown':
            return OS_Key.DOWN;
        case 'ArrowLeft':
            return OS_Key.LEFT;
        case 'Home':
            return OS_Key.HOME;
        case 'End':
            return OS_Key.END;
        case 'F1': return OS_Key.F1;
        case 'F2': return OS_Key.F2;
        case 'F3': return OS_Key.F3;
        case 'F4': return OS_Key.F4;
        case 'F5': return OS_Key.F5;
        case 'F6': return OS_Key.F6;
        case 'F7': return OS_Key.F7;
        case 'F8': return OS_Key.F8;
        case 'F9': return OS_Key.F9;
        case 'F10': return OS_Key.F10;
        case 'F11': return OS_Key.F11;
        case 'F12': return OS_Key.F12;
    }
    
    return OS_Key.UNKNOWN;
}

/**
 * Maps mouse button to OS_Key enum value
 * @param {number} button - Mouse button index (0=left, 1=middle, 2=right)
 * @returns {number} OS_Key enum value
 */
function mapMouseButtonToOSKey(button) {
    switch (button) {
        case 0: return OS_Key.MOUSE_L;
        case 1: return OS_Key.MOUSE_M;
        case 2: return OS_Key.MOUSE_R;
        default: return OS_Key.UNKNOWN;
    }
}

/**
 * Gets the mouse position relative to the canvas
 * @param {MouseEvent} event - The mouse event
 * @returns {{x: number, y: number}} Mouse position
 */
function getMousePos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.floor(event.clientX - rect.left),
        y: Math.floor(event.clientY - rect.top)
    };
}

/**
 * Pushes an event to the event queue
 * @param {number} type - Event type from OS_Window_Event_Type
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} pressed - 1 for pressed/down, 0 for released/up
 * @param {number} key - Key code from OS_Key enum
 */
function pushEvent(type, x, y, pressed, key) {
    eventQueue.push({ type, x, y, pressed, key });
}

/**
 * Writes events to WASM memory using the exported event buffer
 */
function writeEventsToWASM() {
    const count = eventQueue.length;
    if (count === 0) {
        return;
    }
    
    // Get the event buffer pointer from WASM
    const eventBufferPtr = wasm.instance.exports.wasm_get_event_buffer();
    
    // Each OS_Window_Event struct:
    // - type: i32 (4 bytes)
    // - x: i32 (4 bytes)
    // - y: i32 (4 bytes)
    // - pressed: i32 (4 bytes, b32 is 4 bytes)
    // - key: i32 (4 bytes)
    // Total: 20 bytes per event
    const bytesPerEvent = 20;
    
    const buffer = wasm.instance.exports.memory.buffer;
    const view = new DataView(buffer);
    let offset = eventBufferPtr;
    
    const maxEvents = Math.min(count, 128); // MAX_EVENTS_PER_FRAME
    
    for (let i = 0; i < maxEvents; i++) {
        const event = eventQueue[i];
        view.setInt32(offset + 0, event.type, true);
        view.setInt32(offset + 4, event.x, true);
        view.setInt32(offset + 8, event.y, true);
        view.setInt32(offset + 12, event.pressed, true);
        view.setInt32(offset + 16, event.key, true);
        offset += bytesPerEvent;
    }
    
    // Set the event count
    wasm.instance.exports.wasm_set_event_count(maxEvents);
}

/**
 * Clears the event queue (called after frame processing)
 */
function clearEventQueue() {
    eventQueue = [];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculates the length of a null-terminated C string.
 * @param {Uint8Array} mem - Memory view to read from
 * @param {number} ptr - Pointer to the start of the string
 * @returns {number} Length of the string (excluding null terminator)
 */
function cstrlen(mem, ptr) {
    let len = 0;
    while (mem[ptr] != 0) {
        len++;
        ptr++;
    }
    return len;
}

/**
 * Converts a C string pointer to a JavaScript string.
 * @param {ArrayBuffer} mem_buffer - WebAssembly memory buffer
 * @param {number} ptr - Pointer to the string
 * @param {number} count - Number of bytes to read
 * @returns {string} Decoded string
 */
function cstr_by_ptr(mem_buffer, ptr, count) {
    const bytes = new Uint8Array(mem_buffer, ptr, count);
    return new TextDecoder().decode(bytes);
}

/**
 * Creates a Float32Array view from WebAssembly memory.
 * @param {number} ptr - Pointer to the data
 * @param {number} count - Number of floats to read
 * @returns {Float32Array} Float32 array view of the memory
 */
function float32_array_by_ptr(ptr, count) {
    const buffer = wasm.instance.exports.memory.buffer;
    const bytes = new Float32Array(buffer, ptr, count);
    return bytes;
}

/**
 * Converts byte size to WebAssembly page count.
 * @param {number} size - Size in bytes
 * @returns {number} Number of WASM pages needed
 */
function byte_to_wasm_pages(size) {
    const bytesPerPage = 65536; // 64KB per page
    return Math.ceil(size / bytesPerPage);
}

// ============================================================================
// OS Interface Functions (called from WASM)
// ============================================================================

/**
 * @param {number} message_ptr - Pointer to the message string
 * @param {number} count - Length of the message
 */
function js_print(message_ptr, count) {
    const buffer = wasm.instance.exports.memory.buffer;
    const message = cstr_by_ptr(buffer, message_ptr, count);
    console.log(message);
}

/**
 * @param {number} title_ptr - Pointer to the title string
 * @param {number} count - Length of the title
 */
function js_set_title(title_ptr, count) {
    const buffer = wasm.instance.exports.memory.buffer;
    const message = cstr_by_ptr(buffer, title_ptr, count);
    document.title = message;
}

/**
 * @param {number} width - Canvas width in pixels
 * @param {number} height - Canvas height in pixels
 */
function js_create_canvas(width, height) {
    canvas.width = width;
    canvas.height = height;
    gl = canvas.getContext("webgl2");

    gl.clearColor(0, 0, 0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, canvas.width, canvas.height);
}

/**
 * @param {number} new_byte_length - Number of bytes to grow
 */
function js_memory_grow(new_byte_length) {
    const mem = wasm.instance.exports.memory;
    console.log(new_byte_length);
    console.log(mem);
    mem.grow(byte_to_wasm_pages(new_byte_length));
}

/**
 * Returns the current time in milliseconds with high precision.
 * @returns {number} Time in milliseconds since page load
 */
function js_performance_now() {
    return performance.now();
}

// ============================================================================
// WebGL Context and Shader Setup
// ============================================================================

/** @type {WebGL2RenderingContext | null} */
let gl;

const vsSource = `
attribute vec2 vert_pos;
attribute vec4 color;
attribute vec2 uv;

uniform mat4 proj;
uniform mat4 model;

varying vec4 v_color;
varying vec2 v_uv;

void main() {
    gl_Position = proj * model * vec4(vert_pos, 0.0, 1.0);
    v_color = color;
    v_uv = uv;
}
`;

const fsSource = `
precision mediump float;

varying vec4 v_color;
varying vec2 v_uv;

uniform sampler2D u_texture;
uniform bool u_use_texture;
uniform bool is_text;

void main() {
    if (is_text) {
        vec4 tex_color = texture2D(u_texture, v_uv);
        gl_FragColor = vec4(v_color.r, v_color.g, v_color.b, tex_color.a);
    } else if (u_use_texture) {
        gl_FragColor = texture2D(u_texture, v_uv) * v_color;
    } else {
        gl_FragColor = v_color;
    }
}
`;

/**
 * @param {number} type - Shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER)
 * @param {string} source - Shader source code
 * @returns {WebGLShader | null} Compiled shader or null on error
 */
function loadShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(
            `An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`,
        );
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

/**
 * @param {string} vert - Vertex shader source
 * @param {string} frag - Fragment shader source
 * @returns {WebGLProgram | null} Linked shader program or null on error
 */
function initShaderProgram(vert, frag) {
    const vertexShader = loadShader(gl.VERTEX_SHADER, vert);
    const fragmentShader = loadShader(gl.FRAGMENT_SHADER, frag);

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert(
            `Unable to initialize the shader program: ${gl.getProgramInfoLog(shaderProgram)}`,
        );
        return null;
    }

    return shaderProgram;
}

// ============================================================================
// WebGL Rendering State
// ============================================================================

/**
 * Shader program info containing program reference and attribute/uniform locations.
 * @typedef {Object} ProgramInfo
 * @property {WebGLProgram} program - The compiled shader program
 * @property {Object} attribLocations - Attribute location mappings
 * @property {number} attribLocations.vertexPosition - Vertex position attribute location
 * @property {number} attribLocations.color - Color attribute location
 * @property {number} attribLocations.uv - UV coordinate attribute location
 * @property {Object} uniformLocations - Uniform location mappings
 * @property {WebGLUniformLocation} uniformLocations.projectionMatrix - Projection matrix uniform
 * @property {WebGLUniformLocation} uniformLocations.modelViewMatrix - Model-view matrix uniform
 * @property {WebGLUniformLocation} uniformLocations.texture - Texture sampler uniform
 * @property {WebGLUniformLocation} uniformLocations.useTexture - Boolean flag for texture usage
 */

/** @type {ProgramInfo | null} */
let programInfo;

let matProj = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

let matModel = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

// ============================================================================
// Texture Management
// ============================================================================

let textureMap = new Map();
let nextTextureHandle = 1;
let currentTexture = null;
let currentTexturePixelFormat = 0;

/**
 * @readonly
 * @enum {number}
 */
const PixelFormat = {
    RGBA: 0,
    RGB: 1,
    R: 2,
    ALPHA: 3
};

/**
 * @param {number} data_ptr - Pointer to pixel data in WASM memory (0 for empty texture)
 * @param {number} width - Texture width in pixels
 * @param {number} height - Texture height in pixels
 * @param {number} pixel_format - Pixel format (0=RGBA, 1=RGB, 2=R, 3=ALPHA)
 * @param {number} filter - Filter mode (0=nearest, 1=linear)
 * @returns {number} Texture handle for future operations
 */
function webgl_create_texture(data_ptr, width, height, pixel_format, filter) {
    const texture = gl.createTexture();
    const handle = nextTextureHandle++;
    textureMap.set(handle, texture);

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set texture wrapping to clamp to edge to prevent bleeding
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (filter) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    // Determine format and internal format based on pixel_format
    let glFormat, glInternalFormat, bytesPerPixel;

    switch (pixel_format) {
        case PixelFormat.RGBA:
            glFormat = gl.RGBA;
            glInternalFormat = gl.RGBA;
            bytesPerPixel = 4;
            break;
        case PixelFormat.RGB:
            glFormat = gl.RGB;
            glInternalFormat = gl.RGBA;
            bytesPerPixel = 3;
            break;
        case PixelFormat.R:
            glFormat = gl.RED;
            glInternalFormat = gl.RGBA;
            bytesPerPixel = 1;
            break;
        case PixelFormat.ALPHA:
            glFormat = gl.ALPHA;
            glInternalFormat = gl.ALPHA;
            bytesPerPixel = 1;
            break;
    }

    if (data_ptr !== 0) {
        const buffer = wasm.instance.exports.memory.buffer;
        const dataSize = width * height * bytesPerPixel;
        const data = new Uint8Array(buffer, data_ptr, dataSize);
        gl.texImage2D(gl.TEXTURE_2D, 0, glInternalFormat, width, height, 0, glFormat, gl.UNSIGNED_BYTE, data);
    } else {
        // Create empty texture with the correct format
        gl.texImage2D(gl.TEXTURE_2D, 0, glInternalFormat, width, height, 0, glFormat, gl.UNSIGNED_BYTE, null);
    }

    return handle;
}

/**
 * @param {number} handle - Texture handle to destroy
 */
function webgl_destroy_texture(handle) {
    const texture = textureMap.get(handle);
    if (texture) {
        gl.deleteTexture(texture);
        textureMap.delete(handle);
    }
}

/**
 * @param {number} handle - Texture handle to update
 * @param {number} data_ptr - Pointer to pixel data in WASM memory
 * @param {number} stride - Row stride (width) of source data
 * @param {number} x - X offset in texture
 * @param {number} y - Y offset in texture
 * @param {number} w - Width of region to update
 * @param {number} h - Height of region to update
 * @param {number} pixel_format - Pixel format of the data
 */
function webgl_update_texture_region(handle, data_ptr, stride, x, y, w, h, pixel_format) {
    const texture = textureMap.get(handle);
    if (!texture) return;

    gl.bindTexture(gl.TEXTURE_2D, texture);

    const buffer = wasm.instance.exports.memory.buffer;
    let glFormat;
    let bytesPerPixel;

    switch (pixel_format) {
        case PixelFormat.RGBA:
            glFormat = gl.RGBA;
            bytesPerPixel = 4;
            break;
        case PixelFormat.RGB:
            glFormat = gl.RGB;
            bytesPerPixel = 3;
            break;
        case PixelFormat.R:
            glFormat = gl.RED;
            bytesPerPixel = 1;
            break;
        case PixelFormat.ALPHA:
            glFormat = gl.ALPHA;
            bytesPerPixel = 1;
            break;
    }

    const dataSize = h * stride * bytesPerPixel;
    const data = new Uint8Array(buffer, data_ptr, dataSize);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, stride);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
    
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, glFormat, gl.UNSIGNED_BYTE, data);
    
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
}

/**
 * @param {number} handle - Texture handle to bind (0 to unbind)
 */
function webgl_set_texture(handle, pixel_format) {
    if (handle !== 0) {
        const texture = textureMap.get(handle);
        if (texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            currentTexture = texture;
            currentTexturePixelFormat = pixel_format;
        }
    } else {
        gl.bindTexture(gl.TEXTURE_2D, null);
        currentTexture = null;
    }
}

// ============================================================================
// WebGL Rendering Functions
// ============================================================================

/**
 * @param {number} r - Red component (0.0 to 1.0)
 * @param {number} g - Green component (0.0 to 1.0)
 * @param {number} b - Blue component (0.0 to 1.0)
 */
function webgl_clear(r, g, b) {
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * @param {number} mat - Pointer to a 4x4 matrix (16 floats) in WASM memory
 */
function webgl_set_matrix_projection(mat) {
    const source = float32_array_by_ptr(mat, 16);
    matProj = new Float32Array(source);
}

/**
 * @param {number} mat - Pointer to a 4x4 matrix (16 floats) in WASM memory
 */
function webgl_set_matrix_model(mat) {
    const source = float32_array_by_ptr(mat, 16);
    matModel = new Float32Array(source);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 */
function webgl_viewport(x, y, width, height) {
    if (gl) {
        gl.viewport(x, y, width, height);
    }
}

/**
 * @param {number} count - Number of vertices to draw
 * @param {number} vert_data - Pointer to vertex position data
 * @param {number} vert_size - Number of components per vertex (2 or 3)
 * @param {number} vert_stride - Byte stride between vertices
 * @param {number} vert_offset - Byte offset to first vertex
 * @param {number} _uv_data - Pointer to UV coordinate data (unused, uses same buffer)
 * @param {number} uv_stride - Byte stride between UV coordinates
 * @param {number} uv_offset - Byte offset to first UV coordinate
 * @param {number} _color_data - Pointer to color data (unused, uses same buffer)
 * @param {number} color_stride - Byte stride between colors
 * @param {number} color_offset - Byte offset to first color
 * @param {number} color_is_float - Whether color data is float (0=byte, 1=float)
 */
function webgl_draw_vertex_buffer(
    count,
    vert_data,
    vert_size,
    vert_stride,
    vert_offset,
    _uv_data,
    uv_stride,
    uv_offset,
    _color_data,
    color_stride,
    color_offset,
    color_is_float,
) {
    const bufferSizeBytes = count * vert_stride;
    const bufferSizeFloats = bufferSizeBytes / 4;

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        float32_array_by_ptr(vert_data, bufferSizeFloats),
        gl.STREAM_DRAW,
    );

    gl.useProgram(programInfo.program);

    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
    gl.vertexAttribPointer(
        programInfo.attribLocations.vertexPosition,
        vert_size,
        gl.FLOAT,
        false,
        vert_stride,
        vert_offset,
    );

    gl.enableVertexAttribArray(programInfo.attribLocations.color);
    gl.vertexAttribPointer(
        programInfo.attribLocations.color,
        4,
        gl.FLOAT,
        false,
        color_stride,
        color_offset,
    );

    gl.enableVertexAttribArray(programInfo.attribLocations.uv);
    gl.vertexAttribPointer(
        programInfo.attribLocations.uv,
        2,
        color_is_float != 0 ? gl.FLOAT : gl.UNSIGNED_BYTE,
        false,
        uv_stride,
        uv_offset,
    );

    gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, matProj);
    gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix,  false, matModel);

    gl.uniform1i(programInfo.uniformLocations.texture, 0); // Use texture unit 0
    gl.uniform1i(programInfo.uniformLocations.useTexture, currentTexture !== null ? 1 : 0);
    gl.uniform1i(programInfo.uniformLocations.isText, currentTexturePixelFormat === PixelFormat.ALPHA ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, count);

    gl.deleteBuffer(posBuffer);
}

function webgl_init() {
    const shaderProgram = initShaderProgram(vsSource, fsSource);
    programInfo = {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, "vert_pos"),
            color: gl.getAttribLocation(shaderProgram, "color"),
            uv: gl.getAttribLocation(shaderProgram, "uv"),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(shaderProgram, "proj"),
            modelViewMatrix: gl.getUniformLocation(shaderProgram, "model"),
            texture: gl.getUniformLocation(shaderProgram, "u_texture"),
            useTexture: gl.getUniformLocation(shaderProgram, "u_use_texture"),
            isText: gl.getUniformLocation(shaderProgram, "is_text"),
        },
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
}


// ============================================================================
// WASM Module Initialization and Main Loop
// ============================================================================

async function init() {
    const memory = new WebAssembly.Memory({
        initial: 16,
        maximum: byte_to_wasm_pages(512*1024*1024),
    });

    // Preload files before initializing WASM
    await preloadFiles();

    const response = await fetch("swar.wasm");
    const file = await response.arrayBuffer();
    wasm = await WebAssembly.instantiate(file, {
        env: {
            memory,
            js_print,
            js_create_canvas,
            js_set_title,
            js_memory_grow,
            js_performance_now,
            webgl_clear,

            webgl_init,
            webgl_set_matrix_projection,
            webgl_set_matrix_model,
            webgl_draw_vertex_buffer,
            webgl_create_texture,
            webgl_destroy_texture,
            webgl_update_texture_region,
            webgl_set_texture,
            webgl_viewport,
            
            // File system functions
            js_get_file_size,
            js_copy_file_to_wasm,
        },
    });
    wasm.instance.exports.wasm_main();

    setupEventListeners();

    function gameLoop(currentTime) {
        if (wasm && wasm.instance.exports.wasm_frame) {
            if (eventQueue.length > 0) {
                writeEventsToWASM();
            }

            wasm.instance.exports.wasm_frame();
        }
        clearEventQueue();
        requestAnimationFrame(gameLoop);
    }

    requestAnimationFrame(gameLoop);
}

function setupEventListeners() {
    const canvasContainer = document.getElementById('canvas-container');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    
    // Store original canvas size
    let originalWidth = 0;
    let originalHeight = 0;
    
    window.addEventListener('keydown', (event) => {
        const osKey = mapKeyToOSKey(event);
        if (osKey !== OS_Key.UNKNOWN) {
            pushEvent(OS_Window_Event_Type.KEYBOARD, 0, 0, 1, osKey);
            if (!event.key.startsWith('F5') && event.key !== 'F12') {
                event.preventDefault();
            }
        }
    });

    window.addEventListener('keyup', (event) => {
        const osKey = mapKeyToOSKey(event);
        if (osKey !== OS_Key.UNKNOWN) {
            pushEvent(OS_Window_Event_Type.KEYBOARD, 0, 0, 0, osKey);
            if (!event.key.startsWith('F5') && event.key !== 'F12') {
                event.preventDefault();
            }
        }
    });

    canvas.addEventListener('mousedown', (event) => {
        const pos = getMousePos(event);
        const osKey = mapMouseButtonToOSKey(event.button);
        pushEvent(OS_Window_Event_Type.MOUSE_BUTTON, pos.x, pos.y, 1, osKey);
        event.preventDefault();
    });

    canvas.addEventListener('mouseup', (event) => {
        const pos = getMousePos(event);
        const osKey = mapMouseButtonToOSKey(event.button);
        pushEvent(OS_Window_Event_Type.MOUSE_BUTTON, pos.x, pos.y, 0, osKey);
        event.preventDefault();
    });

    canvas.addEventListener('mousemove', (event) => {
        const pos = getMousePos(event);
        mousePos = pos;
        pushEvent(OS_Window_Event_Type.MOUSE_MOVE, pos.x, pos.y, 0, 0);
    });

    canvas.addEventListener('wheel', (event) => {
        const scrollDirectionY = -Math.sign(event.deltaY);
        const scrollDirectionX = -Math.sign(event.deltaX);
        pushEvent(OS_Window_Event_Type.MOUSE_SCROLL, scrollDirectionX, scrollDirectionY, 0, 0);
        event.preventDefault();
    });

    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    fullscreenBtn.addEventListener('click', () => {
        toggleFullscreen();
    });

    function toggleFullscreen() {
        if (!document.fullscreenElement && 
            !document.webkitFullscreenElement && 
            !document.mozFullScreenElement) {
            originalWidth = canvas.width;
            originalHeight = canvas.height;
            const requestFullscreen = canvasContainer.requestFullscreen || 
                                     canvasContainer.webkitRequestFullscreen || 
                                     canvasContainer.mozRequestFullScreen;
            if (requestFullscreen) {
                requestFullscreen.call(canvasContainer).catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            }
        } else {
            const exitFullscreen = document.exitFullscreen || 
                                  document.webkitExitFullscreen || 
                                  document.mozCancelFullScreen;
            if (exitFullscreen) {
                exitFullscreen.call(document);
            }
        }
    }

    function handleFullscreenChange() {
        if (document.fullscreenElement === canvasContainer || 
            document.webkitFullscreenElement === canvasContainer ||
            document.mozFullScreenElement === canvasContainer) {

            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const canvasAspect = originalWidth / originalHeight;
            const screenAspect = screenWidth / screenHeight;
            
            let newWidth, newHeight;
            if (canvasAspect > screenAspect) {
                newWidth = screenWidth;
                newHeight = Math.floor(screenWidth / canvasAspect);
            } else {
                newHeight = screenHeight;
                newWidth = Math.floor(screenHeight * canvasAspect);
            }
            
            canvas.width = newWidth;
            canvas.height = newHeight;
            canvas.style.width = newWidth + 'px';
            canvas.style.height = newHeight + 'px';
            fullscreenBtn.textContent = 'Exit Fullscreen';
            
            pushEvent(OS_Window_Event_Type.RESIZE, newWidth, newHeight, 0, 0);
        } else {
            canvas.width = originalWidth;
            canvas.height = originalHeight;
            canvas.style.width = '';
            canvas.style.height = '';
            fullscreenBtn.textContent = 'Fullscreen';
            
            // Notify WASM of resize
            pushEvent(OS_Window_Event_Type.RESIZE, originalWidth, originalHeight, 0, 0);
        }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);

    canvas.tabIndex = 1;
    canvas.focus();
}

// Start the application
init();
