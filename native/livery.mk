# The livery contact-sheet tool: `make -C native && make -C native -f livery.mk`.
# It is the game minus its three mains, plus src/livery_main.cpp.
CXX      ?= g++
CXXFLAGS ?= -O2 -g -std=c++20 -Wall -Wextra -Wno-unused-parameter -ffp-contract=off
BUILD    := build
OBJS := $(filter-out $(BUILD)/game_main.o $(BUILD)/drive_main.o $(BUILD)/race_main.o $(BUILD)/carmesh_test.o $(BUILD)/livery_main.o, $(wildcard $(BUILD)/*.o))
$(BUILD)/xbr-livery: src/livery_main.cpp $(OBJS)
	$(CXX) $(CXXFLAGS) $(shell pkg-config --cflags sdl3 epoxy freetype2) -o $@ $^ $(shell pkg-config --libs sdl3 epoxy freetype2) -lm
