function runCode(userInput) {
    // This will trigger the custom rule warning
    return eval(userInput);
}

function processInput(input) {
    // This will match the rule pattern
    return doSomething(input);
}

function vulnerableHandler() {
    // This is the source (untrusted data)
    let data = getUserInput();
    
    // The taint flows through variables...
    let processed = data;

    // This is the sink (dangerous execution)
    eval(processed);
}