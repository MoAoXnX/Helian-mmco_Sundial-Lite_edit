#version 330 compatibility

#define SKY_COLOR_UP
#define SMOOTH_CENTER_DEPTH

#ifndef IS_IRIS
    #define WEATHER_SKY_LUT
    uniform sampler2D shadowcolor1;
#endif

#include "/programs/common/Common.vert"
