BINS = empty1.exe empty2.exe

.PHONY: all
all: $(BINS)

CC = gcc
CXX = g++
LINK = $(CC) -o $@ $^
LINK_CXX = $(CXX) -o $@ $^

empty1.exe: empty1.o
	$(LINK)

empty2.exe: empty2.o
	$(LINK)

%.o: %.c
	$(CC) -c $< -g3 -O0

%.o: %.cpp
	$(CXX) -c $< -g3 -O0

.PHONY: clean
clean:
	rm -f $(BINS) *.o
