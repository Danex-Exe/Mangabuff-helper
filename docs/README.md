<h1 align="center">Documentation</h1>
<div align="center">
    <a href="README.md">English</a>
    <a href="ru/README_RU.md">Русский</a>
    <br><br>
</div>

# Mangabuff Quiz Auto Answer

A Tampermonkey userscript that automatically completes quizzes on [mangabuff.ru/quiz](https://mangabuff.ru/quiz) by sending the correct answer for each question.

## Features

- Automatically starts a quiz on page load.
- Extracts the correct answer from the server’s response.
- Sends the answer with a configurable delay.
- Loops through all questions until the quiz is complete.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension if you haven’t already.
2. Click the Tampermonkey icon, select **“Create a new script”**.
3. Replace the default code with the full script (see below).
4. Save the script (Ctrl+S or File → Save).
5. Navigate to `https://mangabuff.ru/quiz` – the script will run automatically.

## Logging

The script logs its actions to the browser console (F12 → Console tab). You can see:
- When the quiz starts and the first answer.
- Each answer sent and the server’s response.
- Any rate‑limit delays.
- Errors, if they occur.

## How It Works

1. When the page loads, the script sends a POST request to /quiz/start to begin the quiz.
2. From the response, it extracts the correct answer (correct_text).
3. After a short initial delay (2 seconds), it sends the answer to /quiz/answer.
4. The loop continues until no new question is provided (quiz finished).

## Disclaimer

Use this script responsibly. Automating actions on a website may violate its terms of service. This script is provided for educational purposes only.