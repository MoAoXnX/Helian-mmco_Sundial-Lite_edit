#version 330 compatibility

#define SHADOW_AND_SKY
#define BASIC_LIGHT vec3(BASICLIGHT_WORLD0 * BW0_R, BASICLIGHT_WORLD0 * BW0_G, BASICLIGHT_WORLD0 * BW0_B)

#include "/programs/deferred/Deferred12.frag"
