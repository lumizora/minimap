// src/shaders/basic.wgsl
// 全局状态 (Group 0)
@group(0) @binding(0) var<uniform> mvpMatrix : mat4x4<f32>;

// 材质状态 (Group 1)
@group(1) @binding(0) var mySampler : sampler;
@group(1) @binding(1) var myTexture : texture_2d<f32>;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) uv : vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = mvpMatrix * vec4<f32>(input.position, 1.0);
    output.uv = input.uv;
    return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
    // 根据 UV 坐标在互联网下载的地图纹理中进行采样
    return textureSample(myTexture, mySampler, input.uv);
}