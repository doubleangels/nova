FROM python:slim

ADD main.py .

RUN pip install -U pip

RUN pip install -U discord-py-interactions pickledb pytz aiohttp google-generativeai sentry-sdk

CMD [ "python", "-u", "./main.py" ]