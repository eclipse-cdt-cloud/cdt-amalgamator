int function1(void) {
    int local_in_function1 = 1;
    return local_in_function1;
}

int main()
{
    int local_in_main = function1();    
    while (1) {
        local_in_main ++;
        local_in_main ++;
    }
    // unreachable
    return local_in_main;
}
