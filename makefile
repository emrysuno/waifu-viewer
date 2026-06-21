.PHONY: dev cpa

dev:
	node fetch.js

cpa:
	cat app.js fetch.js index.html zoom.js random_wallpaper_linux | xclip -selection clipboard
