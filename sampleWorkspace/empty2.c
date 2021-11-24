int function2(void) {
    int local_in_function2 = 2;
    return local_in_function2;
}

int main()
{
    int local_in_main = function2();    
    return local_in_main;
}
