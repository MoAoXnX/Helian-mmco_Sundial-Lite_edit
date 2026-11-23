//     _________      __        __     ___       __     __________      ________        ______        __           
//    /  _____  \    |  |      |  |   |   \     |  |   |   _____  \    |__    __|      /  __  \      |  |          
//   /  /     \__\   |  |      |  |   |    \    |  |   |  |     \  \      |  |        /  /  \  \     |  |          
//  |  |             |  |      |  |   |  |  \   |  |   |  |      |  |     |  |       /  /    \  \    |  |          
//   \  \______      |  |      |  |   |  |\  \  |  |   |  |      |  |     |  |      |  |______|  |   |  |          
//    \______  \     |  |      |  |   |  | \  \ |  |   |  |      |  |     |  |      |   ______   |   |  |          
//           \  \    |  |      |  |   |  |  \  \|  |   |  |      |  |     |  |      |  |      |  |   |  |          
//  ___       |  |   |  |      |  |   |  |   \  |  |   |  |      |  |     |  |      |  |      |  |   |  |          
//  \  \_____/  /     \  \____/  /    |  |    \    |   |  |_____/  /    __|  |__    |  |      |  |   |  |_________ 
//   \_________/       \________/     |__|     \___|   |__________/    |________|   |__|      |__|   |____________|
//
//  General Public License v3.0. Copyright (C) 2026 GeForceLegend.
//  https://github.com/GeForceLegend/Sundial-Lite
//  https://www.gnu.org/licenses/gpl-3.0.en.html
//
//  Visibility bitmask things; Lighting that don't need to be calculated in visibility bitmask
//

layout(location = 0) out vec4 texBuffer3;
layout(location = 1) out vec4 texBuffer5;

in vec2 texcoord;

#ifdef SHADOW_AND_SKY
    in vec3 skyColorUp;
#else
    const vec3 skyColorUp = vec3(0.0);
#endif

#define VB_TRACE_COUNT 1 // [1 2 3 4 5 6 7 8]
#define VB_STEPS 16 // [4 6 8 12 16 20 24 32 40 48 64 80 96 112 128]
#define VB_GI_LENGTH 514.0 // [64.0 80.0 96.0 114.0 128.0 160.0 192.0 224.0 256.0 320.0 384.0 448.0 514.0 640.0 768.0 896.0 1024.0 1280.0 1536.0 1792.0 2048.0]
#define VB_AO_LENGTH 128.0 // [64.0 80.0 96.0 114.0 128.0 160.0 192.0 224.0 256.0 320.0 384.0 448.0 514.0 640.0 768.0 896.0 1024.0 1280.0 1536.0 1792.0 2048.0]

#include "/settings/CloudSettings.glsl"
#include "/settings/GlobalSettings.glsl"
#include "/libs/Uniform.glsl"
#include "/libs/Common.glsl"
#include "/libs/GbufferData.glsl"

// https://graphics.stanford.edu/%7Eseander/bithacks.html#CountBitsSetParallel | license: public domain
uint CountBits(uint v)
{
    v = v - ((v >> 1u) & 0x55555555u);
    v = (v & 0x33333333u) + ((v >> 2u) & 0x33333333u);
    return ((v + (v >> 4u) & 0xF0F0F0Fu) * 0x1010101u) >> 24u;
}

// Edited from https://www.shadertoy.com/view/XcdBWf, here is the source License:
/*
    This work is licensed under a dual license, public domain and MIT, unless noted otherwise. Choose the one that best suits your needs:

    CC0 1.0 Universal https://creativecommons.org/publicdomain/zero/1.0/
    To the extent possible under law, the author has waived all copyrights and related or neighboring rights to this work.

    or

    The MIT License
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"),
    to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
    and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
    DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
    THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

float ArcTan11(vec2 dir)// == ArcTan(dir) / Pi
{
    float x = abs(dir.x);
    float y =     dir.y;

    //float u = 2.0 + x * (1.27324 + x * (-0.189431 + x * (0.0908837 + x * (-0.0511549 + (0.0236728 - 0.005618 * x) * x))));
    float u = 2.0 + x * (1.27324 + x * (-0.189431 + (0.08204 - 0.0242564 * x) * x));

    float f = y / u;

    if(dir.x < 0.0) f = signI(dir.y) - f;

    return f;
}

float ACosPoly(float x)
{
    return 1.5707963267948966 + (-0.20491203466059038 + 0.04832927023878897 * x) * x;
}

float ACos_Approx(float x)
{
    float u = ACosPoly(abs(x)) * sqrt(1.0 - abs(x));

    return x < 0.0 ? PI - u : u;
}

float ACos(float x)
{
    return ACos_Approx(clamp(x, -1.0, 1.0));
}

vec2 ACos(vec2 x)
{
    return vec2(ACos(x.x), ACos(x.y));
}

float ASin01_Approx(float x)// x: [0,1]
{
    return 1.5707963267948966 - ACosPoly(x) * sqrt(1.0 - x);
}

vec4 GetQuaternion(vec3 to)
{
    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
    float s  =                  -to.z;//   dot(from, to);

    float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)

    s    = 1.0 / u;
    xyz *= u * 0.5;

    return vec4(xyz, s);
}

vec2 cmul(vec2 c0, vec2 c1)
{
    return vec2(c0.x * c1.x - c0.y * c1.y,
                c0.y * c1.x + c0.x * c1.y);
}

float SamplePartialSlice(float x, float sin_thVN)
{
    const float Pi   = 3.1415926535897930;
    const float Pi05 = 1.5707963267948966;

    if((abs(x) - 0.5) < 0.5) {
        uint sgn = floatBitsToUint(x) & 0x80000000u;
        x = abs(x);

        float s = sin_thVN;

        float o = s - s * s;
        float slp0 = 1.0 / (1.0 + (Pi  - 1.0        ) * (s - o * 0.30546           ));
        float slp1 = 1.0 / (1.0 - (1.0 - exp2(-20.0)) * (s + o * mix(0.5, 0.785, s)));

        float k = mix(0.1, 0.25, s);

        float a = 1.0 - (Pi - 2.0) / (Pi - 1.0);
        float b = 1.0 / (Pi - 1.0);

        float d0 =   a - slp0 * b;
        float d1 = 1.0 - slp1;

        float f0 = d0 * (Pi * x - ASin01_Approx(x));
        float f1 = d1 * (     x - 1.0);

        float kk = k * k;

        float h0 = sqrt(f0*f0 + kk) - k;
        float h1 = sqrt(f1*f1 + kk) - k;

        float hh = (h0 * h1) / (h0 + h1);

        float y = x - sqrt(hh*(hh + 2.0*k));
        x = uintBitsToFloat(floatBitsToUint(y) ^ sgn);
    }
    return x;
}

// vvsN: view vec space normal | rnd01: [0, 1]
vec2 SamplePartialSliceDir(vec3 vvsN, float rnd01)
{
    float ang0 = rnd01 * PI * 2.0;

    vec2 dir0 = vec2(cos(ang0), sin(ang0));

    float l = inversesqrt(dot(vvsN.xy, vvsN.xy));
    float l2 = 1.0 / l;

    if(l2 > 0.0) {
        vec2 n = vvsN.xy * l;

        // align n with x-axis
        dir0 = cmul(dir0, n * vec2(1.0, -1.0));

        // sample slice angle
        float ang;
        {
            float x = ArcTan11(dir0);
            float sinNV = l2;

            ang = SamplePartialSlice(x, sinNV) * PI;
        }

        // ray space slice direction
        vec2 dir = vec2(cos(ang), sin(ang));

        // align x-axis with n
        dir0 = cmul(dir, n);
    }
    return dir0;
}

vec2 SliceRelCDF_Cos(vec2 x, float angN, float sinN)
{
    vec2 phi = x * PI * 2.0 - PI;

    return -cos(angN - phi) - phi * sinN;
}

// transform v by unit quaternion q.xy0s
vec3 Transform_Qz0(vec3 v, vec4 q)
{
    float k = v.y * q.x - v.x * q.y;
    float g = 2.0 * (v.z * q.w + k);

    vec3 r;
    r.xy = v.xy + q.yx * vec2(g, -g);
    r.z  = v.z  + 2.0 * (q.w * k - v.z * dot(q.xy, q.xy));

    return r;
}

// transform v.xy0 by unit quaternion q.xy0s
vec3 Transform_Vz0Qz0(vec2 v, vec4 q)
{
    float o = q.x * v.y;
    float c = q.y * v.x;

    vec3 b = vec3( o - c,
                  -o + c,
                   o - c);

    return vec3(v, 0.0) + 2.0 * (b * q.yxw);
}

vec4 screenSpaceVisibiliyBitmask(vec3 originViewPos, vec3 normal, vec2 texcoord, float isOriginNotHand) {
    vec3 viewDir = -normalize(originViewPos);
    vec4 Q_toV = GetQuaternion(viewDir);
    vec4 Q_fromV = Q_toV * vec4(vec3(-1.0), 1.0);
    vec3 normalVVS = Transform_Qz0(normal, Q_fromV);

    vec2 noise = texelFetch(noisetex, ivec2(screenSize * texcoord) & 63, 0).xy + vec2(0.734375, 0.359375) * float(frameCounter & 63);
    vec4 originProjPos = vec4(vec3(gbufferProjection[0].x, gbufferProjection[1].y, gbufferProjection[2].z) * originViewPos + gbufferProjection[3].xyz, -originViewPos.z);
    #ifdef TAA
        vec2 taaOffsetScaled = taaOffset;
        #if SR_ENABLE
            taaOffsetScaled = upscaleRatio * taaOffsetScaled;
        #endif
        originProjPos.xy += taaOffsetScaled * originProjPos.w;
    #endif
    float originProjScale = 0.5 / originProjPos.w;
    vec2 originCoord = vec2(originProjPos.xy * originProjScale + 0.5);
    #if SR_ENABLE
        originCoord *= renderScale;
    #endif

    vec4 totalSamples = vec4(0.0);
    for (int i = 0; i < VB_TRACE_COUNT; i++) {
        const float r2Double = 0.7548776662;
        noise = fract(noise + vec2(r2Double, r2Double * r2Double));
        vec2 screenDir = SamplePartialSliceDir(normalVVS, noise.x);
        vec3 rayDir = Transform_Vz0Qz0(screenDir, Q_toV);

        vec4 projDirection = vec4(vec3(gbufferProjection[0].x, gbufferProjection[1].y, gbufferProjection[2].z) * rayDir, -rayDir.z);
        projDirection.xy += gbufferProjection[2].xy * rayDir.z;
        float traceLength = projIntersectionScreenEdge(originProjPos, projDirection);

        vec4 targetProjPos = originProjPos + projDirection * traceLength;
        float targetProjScale = 0.5 / targetProjPos.w;
        vec2 targetCoord = vec2(targetProjPos.xy * targetProjScale + 0.5);
        #if SR_ENABLE
            targetCoord *= renderScale;
        #endif

        vec2 sampleRange = (targetCoord - originCoord) * screenSize;
        float projTraceLength = inversesqrt(dot(sampleRange, sampleRange));
        vec2 stepDir = sampleRange * projTraceLength * texelSize;
        float VB_LENGTH = VB_AO_LENGTH;
        #ifdef VBGI
            VB_LENGTH = VB_GI_LENGTH;
        #endif
        float stepScale = log2(max(1.0 / VB_LENGTH, clamp(projTraceLength, 0.0, 1.0))) / -float(VB_STEPS);

        vec3 sliceN = cross(viewDir, rayDir);
        vec3 projN = normal - sliceN * dot(normal, sliceN);
        float projNSqrLen = dot(projN, projN);
        if (projNSqrLen != 0.0) {
            vec3 T = cross(sliceN, projN);
            float projNRcpLen = inversesqrt(projNSqrLen);
            float cosN = dot(projN, viewDir) * projNRcpLen;
            float angN = signMul(ACos(cosN), dot(viewDir, T));
            float sinN = sin(angN);

            float w0 = clamp((sinN / (cosN + angN * sinN)) * (PI/4.0) + 0.5, 0.0, 1.0);
            float t1 = 0.25 / (cosN + angN * sinN);
            float t01 = (3.0 * cosN + (4.0 * angN + PI) * sinN) * t1;

            // partial slice re-mapping constants
            float w0_remap_mul = 32.0 / (1.0 - w0);
            float w0_remap_add = -w0 * w0_remap_mul + 64.0;
            w0_remap_add += w0_remap_mul * t01;
            w0_remap_mul *= t1;

            uint occBits = 0u;
            float stepSize = exp2(stepScale * noise.y);
            stepScale = exp2(stepScale);

            for (int j = 0; j < VB_STEPS; j++) {
                vec2 sampleCoord = originCoord + stepDir * stepSize;
                ivec2 sampleTexel = ivec2(sampleCoord * screenSize);
                float sampleDepth = uintBitsToFloat(texelFetch(colortex6, sampleTexel, 0).r);
                stepSize *= stepScale;
                vec3 sampleViewPos = vec3(sampleCoord * 2.0 - 1.0, 1.0);
                #ifdef TAA
                    sampleViewPos.xy -= taaOffset;
                #endif
                #if SR_ENABLE
                    sampleViewPos.xy = sampleViewPos.xy * upscaleRatio + upscaleRatio - 1.0;
                #endif
                sampleViewPos.xy = vec2(gbufferProjectionInverse[0].x, gbufferProjectionInverse[1].y) * sampleViewPos.xy + gbufferProjectionInverse[3].xy;

                if (any(greaterThan(floatBitsToUint(sampleCoord), floatBitsToUint(screenEdge)))) {
                    break;
                }
                if (abs(sampleDepth) != 1.0) {
                    float isHand = float(sampleDepth > 1.0);
                    #ifdef LOD
                        if (sampleDepth < 0.0) {
                            sampleViewPos.z = projInvLod()[3].z;
                            sampleViewPos /= projInvLod()[2].w * (-sampleDepth * 2.0 - 1.0) + projInvLod()[3].w;
                        }
                        else
                    #endif
                    {
                        sampleViewPos.z = gbufferProjectionInverse[3].z;
                        sampleViewPos /= gbufferProjectionInverse[2].w * ((sampleDepth - isHand) * 2.0 - 1.0) + gbufferProjectionInverse[3].w;
                    }

                    vec3 deltaPosFront = sampleViewPos - originViewPos;
                    vec3 deltaPosBack = deltaPosFront + sampleViewPos * inversesqrt(clamp(dot(sampleViewPos, sampleViewPos) * (0.1 + 0.15 * isOriginNotHand), 0.0, 1.0)) * 0.1;

                    vec2 horCos = vec2(dot(deltaPosFront, viewDir) * inversesqrt(dot(deltaPosFront, deltaPosFront)),
                                       dot(deltaPosBack , viewDir) * inversesqrt(dot(deltaPosBack , deltaPosBack )));

                    vec2 horAng = ACos(horCos);

                    // shift relative angles from V to N + map to [0,1]
                    vec2 hor01 = clamp((horAng + angN) / PI + 0.5, 0.0, 1.0);

                    // map to slice relative distribution
                    hor01 = SliceRelCDF_Cos(hor01, angN, sinN);

                    // partial slice re-mapping
                    hor01 = hor01 * w0_remap_mul + w0_remap_add;

                    uvec2 horInt = (floatBitsToUint(hor01) >> 17) & 0x3Fu;
                    uint mX = horInt.x < 32u ? 0xFFFFFFFFu <<        horInt.x  : 0u;
                    uint mY = horInt.y != 0u ? 0xFFFFFFFFu >> (32u - horInt.y) : 0u;
                    uint occBits0 = mX & mY;

                    uint visBits0 = occBits0 & (~occBits);
                    occBits = occBits | occBits0;
                    #ifdef VBGI
                        if(visBits0 != 0u) {
                            float vis0 = float(CountBits(visBits0)) * (1.0 / 32.0);
                            vec4 sampleData = texelFetch(colortex3, sampleTexel, 0);
                            totalSamples.rgb += sampleData.rgb * vis0 * clamp(1.0 - isOriginNotHand * isHand, 0.0, 1.0);
                        }
                    #endif
                }
            }
            float occ0 = float(CountBits(occBits)) * (1.0 / 32.0);
            totalSamples.a += occ0;
        }
    }
    totalSamples /= VB_TRACE_COUNT;
    return totalSamples;
}

#ifdef HELD_LIGHT_SHADOW
float heldLightScreenSpaceShadow(vec3 viewPos, vec3 geoNormal, vec3 lightPos, vec3 lightDir, float isOriginNotHand, float noise) {
    float viewZ = -viewPos.z;
    vec2 projScale = vec2(gbufferProjection[0].x, gbufferProjection[1].y);
    float pixelWorldSize = 2.0 * viewZ * max(texelSize.x / max(abs(projScale.x), 1e-4), texelSize.y / max(abs(projScale.y), 1e-4));
    float geoNdotL = clamp(dot(geoNormal, lightDir), 0.0, 1.0);

    vec3 startView = viewPos
        + geoNormal * min(pixelWorldSize * (0.9 + 1.0 / max(geoNdotL, 0.15)), 0.08)
        + lightDir * min(pixelWorldSize * 1.0, 0.04);

    vec3 endView = lightPos;
    if (-endView.z < 0.15) {
        float tClamp = clamp((startView.z + 0.15) / min(startView.z - lightPos.z, -1e-4), 0.0, 1.0);
        endView = mix(startView, lightPos, tClamp);
    }
    float traceDist = length(endView - startView);
    if (traceDist <= 1e-3) {
        return 1.0;
    }

    vec3 startClip = vec3(projScale * startView.xy + gbufferProjection[2].xy * startView.z, -startView.z);
    vec3 endClip   = vec3(projScale * endView.xy   + gbufferProjection[2].xy * endView.z,   -endView.z);
    vec3 rayClip   = endClip - startClip;

    float invSamples = 1.0 / float(HELD_LIGHT_SHADOW_SAMPLES);
    float maxOcc = 0.0;

    for (int i = 0; i < HELD_LIGHT_SHADOW_SAMPLES; i++) {
        float u = (float(i) + noise) * invSamples;
        float t = u * (0.10 + u * (0.30 + 0.60 * u));

        vec3 sampleClip = startClip + rayClip * t;
        if (sampleClip.z <= 0.15) {
            break;
        }

        vec2 sampleUV = (sampleClip.xy / sampleClip.z) * 0.5 + 0.5;
        #if SR_ENABLE
            sampleUV *= renderScale;
        #endif
        #ifdef TAA
            sampleUV += taaOffset * 0.5;
        #endif

        if (any(greaterThanEqual(floatBitsToUint(sampleUV), floatBitsToUint(screenEdge)))) {
            break;
        }

        ivec2 sampleTexel = ivec2(sampleUV * screenSize);
        float sampleDepth = uintBitsToFloat(texelFetch(colortex6, sampleTexel, 0).r);
        bool isHandSample = sampleDepth > 1.000001;

        if (!isHandSample && abs(sampleDepth) >= 0.999999) {
            continue;
        }
        // Ignore the hand holding this light source, while keeping the opposite hand as a shadow caster
        if (isHandSample && sampleClip.x * lightPos.x > 0.0) {
            continue;
        }

        float sampleViewZ;
        if (isHandSample) {
            sampleViewZ = screenToViewDepth(sampleDepth - 1.0);
        }
        #ifdef LOD
            else if (sampleDepth < 0.0) {
                sampleViewZ = screenToViewDepthLod(-sampleDepth);
            }
        #endif
        else {
            sampleViewZ = screenToViewDepth(sampleDepth);
        }

        float depthDiff = sampleClip.z - sampleViewZ;
        if (depthDiff > 0.0) {
            float travelDist = traceDist * t;
            float stepZ = abs(rayClip.z) * (0.10 + u * (0.60 + 1.80 * u)) * invSamples;
            float penumbra;
            float thickness;
            if (isOriginNotHand < 0.5) {
                penumbra = max(pixelWorldSize * 2.0, 0.006 + travelDist * 0.05);
                thickness = clamp(0.10 + travelDist * 0.50 + stepZ * 1.5, 0.10, 0.55);
            } else if (isHandSample) {
                penumbra = max(pixelWorldSize * 2.0, 0.015 + travelDist * 0.06);
                thickness = clamp(0.20 + travelDist * 0.50 + stepZ * 1.5, 0.20, 0.80);
            } else {
                penumbra = max(pixelWorldSize * 2.5, 0.008 + travelDist * 0.07);
                thickness = clamp(0.15 + travelDist * 0.65 + stepZ * 2.2, 0.15, 2.40);
            }

            float frontOcc = smoothstep(0.0, penumbra, depthDiff);
            float backFade = 1.0 - smoothstep(thickness * 0.55, thickness, depthDiff);

            maxOcc = max(maxOcc, frontOcc * backFade);
            if (maxOcc > 0.99) {
                break;
            }
        }
    }

    return 1.0 - 0.78 * maxOcc;
}
#endif

vec3 computeHeldLight(
    int lightValue, vec3 lightPos, vec3 viewPos, vec3 geoNormal, vec3 normal,
    vec3 albedoDiffuse, float aoFactor, float isOriginNotHand, float noise
) {
    if (lightValue <= 0) {
        return vec3(0.0);
    }
    bool isSameHand = (isOriginNotHand < 0.5) && (viewPos.x * lightPos.x > 0.0);
    vec3 effectiveLightPos;
    if (isSameHand) {
        effectiveLightPos = vec3(0.0);
    } else if (isOriginNotHand < 0.5) {
        effectiveLightPos = lightPos;
    } else {
        effectiveLightPos = lightPos * smoothstep(0.05, 0.35, -viewPos.z);
    }
    vec3 lightVec = effectiveLightPos - viewPos;
    float dist = length(lightVec);
    float rangeFade = clamp(1.0 - dist / HELD_LIGHT_RANGE, 0.0, 1.0);
    if (rangeFade <= 0.0) {
        return vec3(0.0);
    }
    vec3 lightDir = lightVec / max(dist, 1e-4);
    float NdotL = clamp(dot(normal, lightDir), 0.0, 1.0);
    if (NdotL <= 0.0) {
        return vec3(0.0);
    }
    float shadow = 1.0;
    #ifdef HELD_LIGHT_SHADOW
        if (!isSameHand) {
            shadow = heldLightScreenSpaceShadow(viewPos, geoNormal, effectiveLightPos, lightDir, isOriginNotHand, noise);
            float shadowDistFade = 1.0 - smoothstep(HELD_LIGHT_RANGE * 0.65, HELD_LIGHT_RANGE, dist);
            shadow = mix(1.0, shadow, shadowDistFade);
        }
    #endif
    float intensity = (float(lightValue) / 15.0) * rangeFade * rangeFade * NdotL * shadow * aoFactor;
    return commonLightColor * intensity * albedoDiffuse;
}

void main() {
    ivec2 texel = ivec2(gl_FragCoord.st);
    GbufferData gbufferData = getGbufferData(texel, texcoord);
    vec3 viewPos;
    float isOriginNotHand = 1.0;
    gbufferData.depth = uintBitsToFloat(texelFetch(colortex6, texel, 0).r);
    #ifdef LOD
        if (gbufferData.depth < 0.0) {
            viewPos = screenToViewPosLod(texcoord, -gbufferData.depth - 1e-7);
        } else
    #endif
    {
        float isHand = float(gbufferData.depth > 1.0);
        isOriginNotHand -= isHand;
        gbufferData.depth -= isHand;
        viewPos = screenToViewPos(texcoord, gbufferData.depth - 1e-7);
    }
    vec4 currData = vec4(0.0);
    vec4 colorData = texelFetch(colortex3, texel, 0);
    if (abs(gbufferData.depth) < 1.0) {
        // Merge some vec3s into floats to save registers
        float NdotV = clamp(dot(viewPos, -gbufferData.normal) * inversesqrt(dot(viewPos, viewPos)), 0.0, 1.0);
        #ifndef SKY_LIGHT_GI
            vec3 plantSkyNormal = mat3(gbufferModelViewInverse) * gbufferData.normal;
            if (gbufferData.materialID == MAT_GRASS) {
                plantSkyNormal = vec3(0.0, 1.0, 0.0);
            }
            float skyLightStrength = mix(pow2(1.0 / (0.75 - 0.75 * 0.75 / (1.0 + 0.75) * gbufferData.lightmap.y) - 1.0 / 0.75), 1.0, SKY_LIGHT_OVERRIDE) *
                (plantSkyNormal.y * 0.3 + 0.6 + mix(dot(plantSkyNormal, sunDirection), dot(plantSkyNormal, shadowDirection), clamp(-sunDirection.y * 10.0, 0.0, 1.0)) * 0.2);
        #endif
        #ifdef IS_IRIS
            vec3 worldPos = viewToWorldPos(viewPos);
            #ifdef DIRECTIONAL_LIGHT_LEVEL
                vec3 viewOffset = worldToViewPos(worldPos + relativeEyePosition);
                float normalAngle = (dot(viewOffset, gbufferData.geoNormal) - dot(viewOffset, gbufferData.normal)) * inversesqrt(dot(viewOffset, viewOffset));
                normalAngle = signMul(sqrt(abs(normalAngle)), normalAngle);
                gbufferData.lightmap.x += normalAngle * DIRECTIONAL_BLOCK_LIGHT_STRENGTH * (gbufferData.lightmap.x - gbufferData.lightmap.x * gbufferData.lightmap.x);
                gbufferData.lightmap.x = clamp(gbufferData.lightmap.x, 0.0, 1.0);
            #endif
        #endif

        viewPos += gbufferData.geoNormal * 3e-3;
        currData = screenSpaceVisibiliyBitmask(viewPos, gbufferData.normal, texcoord, isOriginNotHand);
        vec4 prevData = texelFetch(colortex5, texel, 0);
        float blendWeight = clamp(1.0 / colorData.w, 0.0, 1.0);
        currData = mix(prevData, currData, blendWeight);

        vec3 lightColor = vec3(BASIC_LIGHT);
        #ifdef MOD_NIGHT_VISION_COMPAT
            lightColor += pow(texelFetch(colortex4, ivec2(0), 0).rgb, vec3(2.2)) * NIGHT_VISION_BRIGHTNESS;
        #else
            lightColor += nightVision * NIGHT_VISION_BRIGHTNESS;
        #endif
        const float fadeFactor = VANILLA_BLOCK_LIGHT_FADE;
        vec3 blockLight = pow2(1.0 / (fadeFactor - fadeFactor * fadeFactor / (1.0 + fadeFactor) * gbufferData.lightmap.x) - 1.0 / fadeFactor) * commonLightColor;
        lightColor += blockLight;
        #ifdef SHADOW_AND_SKY
            #ifndef SKY_LIGHT_GI
                lightColor +=
                    skyLightStrength *
                    (skyColorUp + sunColor * 2.0 * SUNLIGHT_BRIGHTNESS * (1.0 - ENVIROMENT_DARKNESS)) *
                    (1.0 - 0.75 * weatherStrength);
            #endif
        #endif
        lightColor *= (1.0 - currData.w * (1.0 - 0.15 * blendWeight));
        #ifdef VBGI
            lightColor += currData.rgb;
        #endif

        float diffuseWeight = pow(1.0 - gbufferData.smoothness, 5.0);
        vec3 f0 = vec3(0.04);
        vec3 f82 = vec3(1.0);
        #ifdef LABPBR_F0
            f0 = mix(f0, vec3(gbufferData.metalness), step(0.001, gbufferData.metalness));
            f82 = hardcodedMetal(gbufferData.metalness);
            gbufferData.metalness = step(229.5 / 255.0, gbufferData.metalness);
        #endif
        f0 = mix(f0, gbufferData.albedo.rgb, gbufferData.metalness);
        #ifndef FULL_REFLECTION
            diffuseWeight = 1.0 - (1.0 - diffuseWeight) * sqrt(clamp(gbufferData.smoothness - (1.0 - gbufferData.smoothness) * (1.0 - 0.6666 * gbufferData.metalness), 0.0, 1.0));
        #endif
        vec3 diffuseAbsorption = (1.0 - gbufferData.metalness) * diffuseAbsorptionWeight(NdotV, gbufferData.smoothness, f0, f82);
        lightColor *= diffuseAbsorption + diffuseWeight / PI;
        lightColor *= gbufferData.albedo.rgb;
        colorData.rgb += lightColor;
        if (heldBlockLightValue > 0 || heldBlockLightValue2 > 0) {
            #ifdef TAA
                float heldNoise = blueNoiseTemporal(texcoord).x;
            #else
                float heldNoise = bayer64(gl_FragCoord.st);
            #endif
            float heldAoFactor = 1.0 - currData.w * 0.5;
            vec3 heldAlbedoDiffuse = gbufferData.albedo.rgb * diffuseAbsorption;
            colorData.rgb += computeHeldLight(
                heldBlockLightValue, vec3(0.45, 0.0, 0.0), viewPos, gbufferData.geoNormal, gbufferData.normal,
                heldAlbedoDiffuse, heldAoFactor, isOriginNotHand, heldNoise
            );
            colorData.rgb += computeHeldLight(
                heldBlockLightValue2, vec3(-0.45, 0.0, 0.0), viewPos, gbufferData.geoNormal, gbufferData.normal,
                heldAlbedoDiffuse, heldAoFactor, isOriginNotHand, fract(heldNoise + 0.5)
            );
        }
    }
    texBuffer3 = vec4(colorData.rgb, 1.0);
    texBuffer5 = currData;
}

/* DRAWBUFFERS:35 */
