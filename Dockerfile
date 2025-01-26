FROM python:alpine

ADD main.py .

RUN pip install -U pip

RUN pip install -U discord-py-interactions pytz aiohttp google-generativeai sentry-sdk supabase
CMD [ "python", "-u", "./main.py" ]