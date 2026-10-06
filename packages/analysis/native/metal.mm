// Thin Metal binding for the separation engine: libraries, pipelines, shared buffers and
// recorded dispatch lists. Every numeric decision lives in the Metal source and its planner.
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <node_api.h>

#include "cpu.h"

#include <cstring>
#include <string>
#include <vector>

namespace {

struct Library { id<MTLLibrary> library; };
struct Pipeline { id<MTLComputePipelineState> state; };
struct Buffer { id<MTLBuffer> buffer; size_t length; };
struct Binding { Buffer *buffer; size_t offset; };
struct Dispatch {
	Pipeline *pipeline;
	std::vector<Binding> bindings;
	std::vector<uint8_t> params;
	MTLSize groups;
	MTLSize threads;
};
struct Recording { std::vector<Dispatch> dispatches; std::vector<size_t> breaks; };

id<MTLDevice> device = nil;
id<MTLCommandQueue> queue = nil;

napi_value fail(napi_env env, const std::string &message) {
	napi_throw_error(env, nullptr, message.c_str());
	return nullptr;
}

bool ready(napi_env env) {
	if (device) return true;
	device = MTLCreateSystemDefaultDevice();
	if (!device) {
		fail(env, "No Metal device.");
		return false;
	}
	queue = [device newCommandQueue];
	return true;
}

template <typename T>
void finalize(napi_env, void *data, void *) { delete static_cast<T *>(data); }

template <typename T>
napi_value wrap(napi_env env, T *value) {
	napi_value out;
	napi_create_external(env, value, finalize<T>, nullptr, &out);
	return out;
}

template <typename T>
T *unwrap(napi_env env, napi_value value) {
	void *data = nullptr;
	if (napi_get_value_external(env, value, &data) != napi_ok || !data) return nullptr;
	return static_cast<T *>(data);
}

std::string text(napi_env env, napi_value value) {
	size_t length = 0;
	napi_get_value_string_utf8(env, value, nullptr, 0, &length);
	std::string out(length, '\0');
	napi_get_value_string_utf8(env, value, out.data(), length + 1, &length);
	return out;
}

double number(napi_env env, napi_value value) {
	double out = 0;
	napi_get_value_double(env, value, &out);
	return out;
}

napi_value property(napi_env env, napi_value object, const char *name) {
	napi_value out;
	napi_get_named_property(env, object, name, &out);
	return out;
}

bool bytes(napi_env env, napi_value value, uint8_t **data, size_t *length) {
	bool typed = false;
	napi_is_typedarray(env, value, &typed);
	if (!typed) return false;
	napi_typedarray_type type;
	size_t count = 0, offset = 0;
	napi_value arraybuffer;
	void *base = nullptr;
	napi_get_typedarray_info(env, value, &type, &count, &base, &arraybuffer, &offset);
	size_t width = 1;
	switch (type) {
		case napi_int16_array: case napi_uint16_array: width = 2; break;
		case napi_int32_array: case napi_uint32_array: case napi_float32_array: width = 4; break;
		case napi_float64_array: case napi_bigint64_array: case napi_biguint64_array: width = 8; break;
		default: break;
	}
	*data = static_cast<uint8_t *>(base);
	*length = count * width;
	return true;
}

napi_value deviceName(napi_env env, napi_callback_info) {
	napi_value out;
	id<MTLDevice> probe = device ?: MTLCreateSystemDefaultDevice();
	if (!probe) {
		napi_get_null(env, &out);
		return out;
	}
	napi_create_string_utf8(env, probe.name.UTF8String, NAPI_AUTO_LENGTH, &out);
	return out;
}

napi_value createLibrary(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	if (!ready(env)) return nullptr;
	@autoreleasepool {
		MTLCompileOptions *options = [MTLCompileOptions new];
		// IEEE results except subnormals; the source pins contraction off itself.
		if (@available(macOS 15.0, *)) {
			options.mathMode = MTLMathModeSafe;
			options.mathFloatingPointFunctions = MTLMathFloatingPointFunctionsPrecise;
		} else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
			options.fastMathEnabled = NO;
#pragma clang diagnostic pop
		}
		NSError *error = nil;
		id<MTLLibrary> library = [device newLibraryWithSource:@(text(env, argv[0]).c_str()) options:options error:&error];
		if (!library) return fail(env, std::string("Metal compile failed: ") + error.localizedDescription.UTF8String);
		return wrap(env, new Library{library});
	}
}

napi_value createPipeline(napi_env env, napi_callback_info info) {
	size_t argc = 2;
	napi_value argv[2];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	Library *library = unwrap<Library>(env, argv[0]);
	if (!library) return fail(env, "Expected a Metal library.");
	@autoreleasepool {
		id<MTLFunction> function = [library->library newFunctionWithName:@(text(env, argv[1]).c_str())];
		if (!function) return fail(env, "No such Metal function: " + text(env, argv[1]));
		NSError *error = nil;
		id<MTLComputePipelineState> state = [device newComputePipelineStateWithFunction:function error:&error];
		if (!state) return fail(env, std::string("Metal pipeline failed: ") + error.localizedDescription.UTF8String);
		return wrap(env, new Pipeline{state});
	}
}

napi_value createBuffer(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	if (!ready(env)) return nullptr;
	const size_t length = static_cast<size_t>(number(env, argv[0]));
	id<MTLBuffer> buffer = [device newBufferWithLength:std::max<size_t>(length, 16) options:MTLResourceStorageModeShared];
	if (!buffer) return fail(env, "Could not allocate a Metal buffer of " + std::to_string(length) + " bytes.");
	memset(buffer.contents, 0, buffer.length);
	return wrap(env, new Buffer{buffer, length});
}

napi_value freeBuffer(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	if (Buffer *buffer = unwrap<Buffer>(env, argv[0])) {
		buffer->buffer = nil;
		buffer->length = 0;
	}
	return nullptr;
}

napi_value copyBuffer(napi_env env, napi_callback_info info, bool write) {
	size_t argc = 3;
	napi_value argv[3];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	Buffer *buffer = unwrap<Buffer>(env, argv[0]);
	if (!buffer || !buffer->buffer) return fail(env, "Expected a live Metal buffer.");
	const size_t offset = static_cast<size_t>(number(env, argv[1]));
	uint8_t *data = nullptr;
	size_t length = 0;
	if (!bytes(env, argv[2], &data, &length)) return fail(env, "Expected a typed array.");
	if (offset + length > buffer->length) return fail(env, "Metal buffer access out of range.");
	uint8_t *contents = static_cast<uint8_t *>(buffer->buffer.contents) + offset;
	if (write) memcpy(contents, data, length);
	else memcpy(data, contents, length);
	return nullptr;
}

napi_value writeBuffer(napi_env env, napi_callback_info info) { return copyBuffer(env, info, true); }
napi_value readBuffer(napi_env env, napi_callback_info info) { return copyBuffer(env, info, false); }

MTLSize size3(napi_env env, napi_value array) {
	uint32_t length = 0;
	napi_get_array_length(env, array, &length);
	NSUInteger v[3] = {1, 1, 1};
	for (uint32_t i = 0; i < length && i < 3; i++) {
		napi_value item;
		napi_get_element(env, array, i, &item);
		v[i] = static_cast<NSUInteger>(number(env, item));
	}
	return MTLSizeMake(v[0], v[1], v[2]);
}

// record([{ pipeline, bindings: [[buffer, offset], ...], params?: Uint8Array, groups, threads, flush? }])
napi_value record(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	uint32_t count = 0;
	napi_get_array_length(env, argv[0], &count);
	auto *recording = new Recording();
	recording->dispatches.reserve(count);
	for (uint32_t i = 0; i < count; i++) {
		napi_value command;
		napi_get_element(env, argv[0], i, &command);
		Dispatch dispatch{};
		dispatch.pipeline = unwrap<Pipeline>(env, property(env, command, "pipeline"));
		if (!dispatch.pipeline) {
			delete recording;
			return fail(env, "Dispatch " + std::to_string(i) + " has no pipeline.");
		}
		napi_value bindings = property(env, command, "bindings");
		uint32_t bound = 0;
		napi_get_array_length(env, bindings, &bound);
		for (uint32_t b = 0; b < bound; b++) {
			napi_value pair, buffer, offset;
			napi_get_element(env, bindings, b, &pair);
			napi_get_element(env, pair, 0, &buffer);
			napi_get_element(env, pair, 1, &offset);
			Buffer *target = unwrap<Buffer>(env, buffer);
			if (!target) {
				delete recording;
				return fail(env, "Dispatch " + std::to_string(i) + " binds something that is not a buffer.");
			}
			dispatch.bindings.push_back({target, static_cast<size_t>(number(env, offset))});
		}
		napi_value params = property(env, command, "params");
		napi_valuetype kind;
		napi_typeof(env, params, &kind);
		if (kind == napi_object) {
			uint8_t *data = nullptr;
			size_t length = 0;
			if (bytes(env, params, &data, &length)) dispatch.params.assign(data, data + length);
		}
		dispatch.groups = size3(env, property(env, command, "groups"));
		dispatch.threads = size3(env, property(env, command, "threads"));
		napi_value flush = property(env, command, "flush");
		bool split = false;
		napi_get_value_bool(env, flush, &split);
		recording->dispatches.push_back(std::move(dispatch));
		if (split) recording->breaks.push_back(recording->dispatches.size());
	}
	return wrap(env, recording);
}

// execute(recording): runs every dispatch in order and returns the GPU milliseconds.
napi_value execute(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	Recording *recording = unwrap<Recording>(env, argv[0]);
	if (!recording || !ready(env)) return fail(env, "Expected a recording.");
	double gpuSeconds = 0;
	@autoreleasepool {
		std::vector<id<MTLCommandBuffer>> buffers;
		size_t start = 0;
		std::vector<size_t> ends = recording->breaks;
		if (ends.empty() || ends.back() != recording->dispatches.size()) ends.push_back(recording->dispatches.size());
		for (size_t end : ends) {
			if (end <= start) continue;
			id<MTLCommandBuffer> commands = [queue commandBuffer];
			id<MTLComputeCommandEncoder> encoder = [commands computeCommandEncoder];
			for (size_t i = start; i < end; i++) {
				const Dispatch &d = recording->dispatches[i];
				[encoder setComputePipelineState:d.pipeline->state];
				NSUInteger index = 0;
				for (const Binding &b : d.bindings) {
					if (!b.buffer->buffer) {
						[encoder endEncoding];
						return fail(env, "A dispatch binds a freed buffer.");
					}
					[encoder setBuffer:b.buffer->buffer offset:b.offset atIndex:index++];
				}
				if (!d.params.empty()) [encoder setBytes:d.params.data() length:d.params.size() atIndex:index];
				[encoder dispatchThreadgroups:d.groups threadsPerThreadgroup:d.threads];
			}
			[encoder endEncoding];
			[commands commit];
			buffers.push_back(commands);
			start = end;
		}
		for (id<MTLCommandBuffer> commands : buffers) {
			[commands waitUntilCompleted];
			if (commands.status != MTLCommandBufferStatusCompleted) {
				NSString *reason = commands.error ? commands.error.localizedDescription : @"unknown error";
				return fail(env, std::string("Metal command buffer failed: ") + reason.UTF8String);
			}
			gpuSeconds += commands.GPUEndTime - commands.GPUStartTime;
		}
	}
	napi_value out;
	napi_create_double(env, gpuSeconds * 1000, &out);
	return out;
}

float *contents(napi_env env, napi_value value, napi_value offset, size_t floats) {
	Buffer *buffer = unwrap<Buffer>(env, value);
	if (!buffer || !buffer->buffer) return nullptr;
	const size_t at = static_cast<size_t>(number(env, offset));
	if (at % 4 != 0 || at + floats * 4 > buffer->length) return nullptr;
	return reinterpret_cast<float *>(static_cast<uint8_t *>(buffer->buffer.contents) + at);
}

const float *floats(napi_env env, napi_value value, size_t count) {
	uint8_t *data = nullptr;
	size_t length = 0;
	if (!bytes(env, value, &data, &length) || length < count * 4) return nullptr;
	return reinterpret_cast<const float *>(data);
}

// normStats(buffer, byteOffset, instances, size, stride, channels, epsilon, gamma, beta, affine)
napi_value normStats(napi_env env, napi_callback_info info) {
	size_t argc = 10;
	napi_value argv[10];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	const size_t instances = static_cast<size_t>(number(env, argv[2])), size = static_cast<size_t>(number(env, argv[3]));
	const size_t stride = static_cast<size_t>(number(env, argv[4])), channels = static_cast<size_t>(number(env, argv[5]));
	const float *x = contents(env, argv[0], argv[1], (instances - 1) * stride + size);
	const float *gamma = floats(env, argv[7], channels), *beta = floats(env, argv[8], channels);
	napi_value zero;
	napi_create_double(env, 0, &zero);
	float *affine = contents(env, argv[9], zero, instances * 2);
	if (!x || !gamma || !beta || !affine) return fail(env, "normStats: bad arguments.");
	napi_value out;
	napi_create_uint32(env, instanceNormStats(x, instances, size, stride, channels,
		static_cast<float>(number(env, argv[6])), gamma, beta, affine), &out);
	return out;
}

// gemmRows(a, aOffset, b, bOffset, y, yOffset, rows, bias | null, guard, outSlot,
//          [m, n, k, kBlock, lda, ldb, ldc, batch, batchA, batchB, batchC, alpha])
// Recomputes the marked rows on the CPU, then folds their range into the guard as note() does.
napi_value gemmRowsMethod(napi_env env, napi_callback_info info) {
	size_t argc = 11;
	napi_value argv[11];
	napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
	double d[12];
	for (uint32_t i = 0; i < 12; i++) {
		napi_value item;
		if (napi_get_element(env, argv[10], i, &item) != napi_ok) return fail(env, "gemmRows: bad dimensions.");
		d[i] = number(env, item);
	}
	GemmRows g{};
	g.m = size_t(d[0]); g.n = size_t(d[1]); g.k = size_t(d[2]); g.kBlock = size_t(d[3]);
	g.lda = size_t(d[4]); g.ldb = size_t(d[5]); g.ldc = size_t(d[6]); g.batch = size_t(d[7]);
	g.batchA = size_t(d[8]); g.batchB = size_t(d[9]); g.batchC = size_t(d[10]); g.alpha = float(d[11]);
	if (!g.m || !g.n || !g.k || !g.kBlock || !g.batch) return fail(env, "gemmRows: empty product.");
	napi_value zero;
	napi_create_double(env, 0, &zero);
	g.a = contents(env, argv[0], argv[1], (g.batch - 1) * g.batchA + (g.m - 1) * g.lda + g.k);
	g.b = contents(env, argv[2], argv[3], (g.batch - 1) * g.batchB + (g.k - 1) * g.ldb + g.n);
	g.y = contents(env, argv[4], argv[5], (g.batch - 1) * g.batchC + (g.m - 1) * g.ldc + g.n);
	g.rows = reinterpret_cast<const uint32_t *>(contents(env, argv[6], zero, g.batch * g.m));
	napi_valuetype kind;
	napi_typeof(env, argv[7], &kind);
	g.bias = kind == napi_null ? nullptr : contents(env, argv[7], zero, g.n);
	const size_t slot = size_t(number(env, argv[9]));
	uint32_t *guard = reinterpret_cast<uint32_t *>(contents(env, argv[8], zero, slot + 2));
	if (!g.a || !g.b || !g.y || !g.rows || !guard || (kind != napi_null && !g.bias)) return fail(env, "gemmRows: bad arguments.");
	uint32_t least = 0x7f800000u;
	g.least = &least;
	guard[0] |= gemmRows(g);
	guard[1 + slot] = std::min(guard[1 + slot], least);
	return nullptr;
}

napi_value init(napi_env env, napi_value exports) {
	const struct { const char *name; napi_callback callback; } methods[] = {
		{"deviceName", deviceName}, {"createLibrary", createLibrary}, {"createPipeline", createPipeline},
		{"createBuffer", createBuffer}, {"freeBuffer", freeBuffer}, {"writeBuffer", writeBuffer},
		{"readBuffer", readBuffer}, {"record", record}, {"execute", execute}, {"normStats", normStats},
		{"gemmRows", gemmRowsMethod}
	};
	for (const auto &method : methods) {
		napi_value fn;
		napi_create_function(env, method.name, NAPI_AUTO_LENGTH, method.callback, nullptr, &fn);
		napi_set_named_property(env, exports, method.name, fn);
	}
	return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
