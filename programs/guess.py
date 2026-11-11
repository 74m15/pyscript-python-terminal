"""Number guessing game — a plain input()/print() program, nothing special needed."""
import random

print("I'm thinking of a number between 1 and 100.")
secret = random.randint(1, 100)
tries = 0

while True:
    try:
        text = input("Your guess: ")
    except EOFError:
        print(f"\nGiving up? It was {secret}.")
        break
    if not text.strip().isdigit():
        print("Please type a whole number.")
        continue
    guess = int(text)
    tries += 1
    if guess < secret:
        print("Higher ↑")
    elif guess > secret:
        print("Lower ↓")
    else:
        print(f"\x1b[32mCorrect!\x1b[0m You got it in {tries} {'try' if tries == 1 else 'tries'}.")
        if input("Play again? (y/n) ").strip().lower().startswith("y"):
            secret, tries = random.randint(1, 100), 0
            print("New number chosen.")
        else:
            break
