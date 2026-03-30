// ==UserScript==
// @name         Mangabuff Quiz Auto Answer
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Automatically starts a quiz and repeatedly sends correct answers
// @author       DanexExe
// @match        *://mangabuff.ru/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    function getCsrfToken() {
        let token = null;
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) {
            token = meta.getAttribute('content');
        }
        if (!token) {
            const cookies = document.cookie.split('; ');
            for (let cookie of cookies) {
                if (cookie.startsWith('XSRF-TOKEN=')) {
                    token = decodeURIComponent(cookie.split('=')[1]);
                    break;
                }
            }
        }
        return token;
    }

    function postRequest(url, data, onSuccess, onError) {
        const csrfToken = getCsrfToken();
        const headers = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        if (csrfToken) {
            headers['X-CSRF-TOKEN'] = csrfToken;
            headers['X-XSRF-TOKEN'] = csrfToken;
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: headers,
            data: JSON.stringify(data),
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    onSuccess(response);
                } else {
                    onError(response);
                }
            },
            onerror: function(error) {
                onError(error);
            }
        });
    }

    function sendAnswer(answer, onSuccess, onError) {
        postRequest('https://mangabuff.ru/quiz/answer', { answer: answer }, onSuccess, onError);
    }

    function sendAnswerWithDelay(answer) {
        setTimeout(() => {
            sendAnswer(answer, onAnswerSuccess, onAnswerError);
        }, 2000);
    }

    function onAnswerSuccess(response) {
        try {
            const data = JSON.parse(response.responseText);
            console.log('Answer sent. Response:', data);
            if (data.question && data.question.correct_text) {
                const nextAnswer = data.question.correct_text;
                sendAnswerWithDelay(nextAnswer);
            } else {
                console.log('Quiz completed or no next question.');
            }
        } catch (e) {
            console.error('Failed to parse answer response:', e);
        }
    }

    function onAnswerError(error) {
        console.error('Error sending answer:', error);
    }

    function onStartSuccess(response) {
        try {
            const startData = JSON.parse(response.responseText);
            const firstAnswer = startData.question.correct_text;
            sendAnswerWithDelay(firstAnswer);
        } catch (e) {
            console.error('Failed to parse start response:', e);
        }
    }

    function onStartError(error) {
        console.error('Error starting quiz:', error);
    }

    postRequest('https://mangabuff.ru/quiz/start', {}, onStartSuccess, onStartError);
})();